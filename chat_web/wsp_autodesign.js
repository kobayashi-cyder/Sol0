/** Sol-Zero 0.7 - deterministic WSP circuit synthesizer, no pretrained models.
 * Observations (train) -> discriminating character features -> numerical ReLU
 * circuits -> sealed, separate validation -> explicit promotion / rollback.
 * "Goal" is documentation, not natural-language comprehension.
 */
import {WSPBulk} from './wsp_bulk.js';
export const AUTO_MAX_TRAIN=256, AUTO_MAX_VALIDATION=128;
const norm=x=>String(x).normalize('NFKC').trim().toLowerCase();
const key=x=>norm(x).replace(/[\s\p{P}\p{S}]+/gu,'');
const verifiedReports=new WeakMap();
function example(x,validation=false){
  if(!x||typeof x!=='object'||typeof x.input!=='string'||x.input.length>300||!x.input.trim()||
    (typeof x.output!=='string' && !(validation&&x.output===null)))throw Error('例はinputとoutput（未知はnull）を指定してください。');
  if(typeof x.output==='string'&&(!x.output.trim()||x.output.length>500))throw Error('回答は1〜500文字です。');
  return {input:x.input.trim(),output:x.output===null?null:x.output.trim()};
}
export function validateTask(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('設計仕様はJSONオブジェクトにしてください。');
  if(typeof raw.goal!=='string'||!raw.goal.trim()||raw.goal.length>180)throw Error('目標を1〜180文字で指定してください。');
  if(!Array.isArray(raw.train)||raw.train.length<4||raw.train.length>AUTO_MAX_TRAIN)throw Error('訓練例は4〜256件必要です。');
  if(!Array.isArray(raw.validation)||raw.validation.length<2||raw.validation.length>AUTO_MAX_VALIDATION)throw Error('独立検証例は2〜128件必要です。');
  const train=raw.train.map(x=>example(x)),validation=raw.validation.map(x=>example(x,true));
  if(train.reduce((n,e)=>n+e.input.length,0)>12000)throw Error('訓練入力は合計12,000文字以内にしてください。');
  const known=new Map(),groups=new Map();
  for(const e of train){const k=key(e.input);if(!k)throw Error('記号だけの訓練入力は不可です。');
    if(known.has(k)&&known.get(k)!==e.output)throw Error('矛盾する訓練例があります。');
    if(known.has(k))throw Error('同じ訓練入力が重複しています。');
    known.set(k,e.output);groups.set(e.output,(groups.get(e.output)||0)+1);
  }
  if(groups.size<2)throw Error('異なる出力カテゴリが少なくとも2つ必要です。');
  if(groups.size>64)throw Error('出力カテゴリは64種類までです。');
  for(const [label,n] of groups)if(n<2)throw Error(`出力「${label.slice(0,24)}」の訓練例が2件未満です。`);
  const validSet=new Set();
  for(const e of validation){const k=key(e.input);if(!k||known.has(k)||validSet.has(k))throw Error('検証例の重複、または訓練例との重複は禁止です。');
    validSet.add(k);if(e.output!==null&&!groups.has(e.output))throw Error('検証例に訓練していない出力があります。');
  }
  const minAccuracy=raw.minAccuracy===undefined?1:Number(raw.minAccuracy);
  if(!Number.isFinite(minAccuracy)||minAccuracy<0.5||minAccuracy>1)throw Error('minAccuracyは0.5〜1.0です。');
  const maxRules=raw.maxRules===undefined?64:Number(raw.maxRules);
  if(!Number.isInteger(maxRules)||maxRules<1||maxRules>512)throw Error('maxRulesは1〜512です。');
  return {goal:raw.goal.trim(),train,validation,maxRules,minAccuracy};
}
function features(input){
  // One feature is a contiguous character substring. No pretrained tokenizers.
  const s=norm(input),out=new Set(),chars=[...s];
  for(let i=0;i<chars.length;i++){
    if(/\s/u.test(chars[i]))continue;
    for(let n=2;n<=8 && i+n<=chars.length;n++){
      const v=chars.slice(i,i+n).join('');
      if(/[\s\p{C}]/u.test(v)||!/[\p{L}]/u.test(v))continue;
      out.add(v);
    }
  }
  return out;
}
function safeId(i){return `auto_${String(i).padStart(3,'0')}`;}
export function synthesize(task){
  const spec=validateTask(task);
  const feats=spec.train.map(e=>features(e.input)), labels=[...new Set(spec.train.map(e=>e.output))],rules=[],uncovered=new Set(spec.train.map((_,i)=>i));
  // Candidate ngram features must have zero false positives in *training*.
  // All validation labels remain unseen by synthesis and are only read by evaluate.
  const index=new Map();
  feats.forEach((set,i)=>{for(const f of set){if(!index.has(f))index.set(f,[]);index.get(f).push(i);}});
  const candidates=[];
  for(const [f,hits] of index){
    const hitLabels=new Set(hits.map(i=>spec.train[i].output));
    if(hitLabels.size!==1)continue;
    const label=spec.train[hits[0]].output;
    // Require feature support on at least 2 independent examples: no 1-example memorization.
    if(hits.length<2)continue;
    candidates.push({feature:f,hit:hits,label});
  }
  while(uncovered.size && rules.length<spec.maxRules){
    let best=null,score=-Infinity;
    for(const c of candidates){
      const cover=c.hit.filter(i=>uncovered.has(i));if(!cover.length)continue;
      // Strong support first; then longer distinctive ngrams (not a learned representation).
      const s=cover.length*1000+c.hit.length*15+Math.min(c.feature.length,8);
      if(s>score||(s===score&&c.feature.localeCompare(best?.feature||'')<0)){best=c;score=s;}
    }
    if(!best)break;
    rules.push({id:safeId(rules.length),all:[best.feature],response:best.label,priority:0});
    for(const i of best.hit)uncovered.delete(i);
  }
  const circuit=new WSPBulk();circuit.replaceRules(rules);
  return {spec,rules,circuit,uncoveredTrain:[...uncovered].map(i=>spec.train[i].input),designedFrom:spec.train.length};
}
export function evaluate(circuit,examples){
  const items=examples.map(e=>{
    const p=circuit.infer(e.input),actual=p.match?.response??null;
    return {input:e.input,expected:e.output,actual,passed:actual===e.output,matchedRule:p.match?.rule??null};
  });
  const correct=items.filter(x=>x.passed).length, falsePositive=items.filter(x=>x.expected===null&&x.actual!==null).length;
  return {total:items.length,correct,accuracy:items.length?correct/items.length:0,falsePositive,errors:items.filter(x=>!x.passed)};
}
export function designAndVerify(raw){
  const built=synthesize(raw),{spec,circuit,rules}=built;
  const training=evaluate(circuit,spec.train),validation=evaluate(circuit,spec.validation);
  const accepted=training.correct===training.total && validation.accuracy>=spec.minAccuracy && validation.falsePositive===0;
  const reasons=[];
  if(training.correct!==training.total)reasons.push('訓練例を全件再現できません。');
  if(validation.accuracy<spec.minAccuracy)reasons.push('未知の検証例で必要な精度に達しません。');
  if(validation.falsePositive)reasons.push('回答すべきでない入力に誤応答しました。');
  const report={accepted,goal:spec.goal,rules,stats:circuit.stats(),training,validation,uncoveredTrain:built.uncoveredTrain,reasons};
  if(accepted)verifiedReports.set(report,JSON.stringify(rules));
  return report;
}
export function promoteVerified(report,bulk){
  if(!report?.accepted || !Array.isArray(report.rules) || !(bulk instanceof WSPBulk) ||
    verifiedReports.get(report)!==JSON.stringify(report.rules))throw Error('合格済みの回路のみ適用できます。');
  const stats=bulk.replaceRules(report.rules);return stats;
}
// Deterministic synthesis of a step controller. Not language-planning or autonomous OS action.
export function planFlow(raw){
  if(!raw || typeof raw!=='object'||typeof raw.goal!=='string'||!raw.goal.trim()||raw.goal.length>180||
    !Array.isArray(raw.steps)||raw.steps.length<1||raw.steps.length>40)throw Error('目標と1〜40件の工程が必要です。');
  const clean=x=>typeof x==='string'?x.trim():'';
  const steps=raw.steps.map((s,i)=>{
    if(!s||!clean(s.name)||!clean(s.action)||clean(s.name).length>40||clean(s.action).length>300||
      !/^[-_\p{L}\p{N} ]+$/u.test(s.name))throw Error(`工程${i+1}の名前か説明が不正です。`);
    return {name:clean(s.name),action:clean(s.action)};
  });
  if(new Set(steps.map(s=>s.name)).size!==steps.length||steps.some(s=>['待機','完了'].includes(s.name)))throw Error('工程名は重複せず、待機・完了以外を指定してください。');
  const transitions=[{from:'待機',event:'開始',to:steps[0].name,action:steps[0].action}];
  steps.forEach((s,i)=>{
    const next=steps[i+1];transitions.push({from:s.name,event:'成功',to:next?.name||'完了',action:next?.action||'全工程の成功を記録する'});
    transitions.push({from:s.name,event:'失敗',to:s.name,action:`再試行候補：${s.action}`});
    transitions.push({from:s.name,event:'中止',to:'待機',action:'外部処理は実行せず待機へ戻る'});
  });
  transitions.push({from:'完了',event:'リセット',to:'待機',action:'次の仕事を受け付ける'});
  return {initial:'待機',transitions};
}
export const AUTO_DEMO={
  goal:'例から、挨拶・計算相談・不具合相談の分類回路を自動設計する',
  train:[
    {input:'おはようございます',output:'あいさつ'},
    {input:'おはよう！',output:'あいさつ'},
    {input:'計算して 12+8',output:'計算'},
    {input:'計算をお願いします',output:'計算'},
    {input:'エラーが表示されました',output:'不具合'},
    {input:'エラーの原因を知りたい',output:'不具合'}
  ],
  validation:[
    {input:'おはよう、今日もよろしく',output:'あいさつ'},
    {input:'計算の結果を教えて',output:'計算'},
    {input:'エラーを修正したい',output:'不具合'},
    {input:'おすすめの音楽は？',output:null}
  ], minAccuracy:1,maxRules:16
};
export const AUTO_FLOW_DEMO={goal:'問題解決の手順を制御する',steps:[
  {name:'分析',action:'観測事実と目標を確認する'},
  {name:'設計',action:'候補回路とテストを生成する'},
  {name:'検証',action:'独立検証を実行し合否を記録する'}
]};
