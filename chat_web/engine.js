/* Sol-Zero Chat v0.6 — entirely local, explicit rules and WSP circuit.
 * No pretrained weights, no network calls, no arbitrary code execution.
 */
import {predictLearnedIntent, LEARNED_ROUTER_META} from './learned_router.js';
import {generateCode,codeHelp} from './code_workshop.js';
import {WeightSpaceNetwork,NEURAL_DEMO,trainAndVerifyNeural,promoteNeural} from './wsp_neural.js';
import {BANC_COGNITION} from './banc_cognition.js';
import {generateWSPCode} from './wsp_codegen.js';
export const ENGINE_VERSION = '0.15.0';
export const FEATURE_SETS = Object.freeze({
  greeting: ['こんにちは','こんばんは','おはよう','はじめまして','やあ','hello','hi'],
  identity: ['あなたは','君は','誰ですか','名前は','sol-zero','solzero','何者'],
  help: ['使い方','ヘルプ','できること','何ができる','/help','機能'],
  gratitude: ['ありがとう','助かっ','感謝','thanks'],
  code: ['コード','プログラム','python','javascript','コーディング'],
  reasoning: ['どうして','なぜ','理由','考えて','推論'],
  multimodal: ['画像','写真','動画','音声'],
  casual: ['雑談','会話','話そう','よろしく'],
});
export const INTENTS = Object.freeze(Object.keys(FEATURE_SETS));
export function normalized(s) { return String(s).normalize('NFKC').trim().toLowerCase(); }
function questionKey(s) { return normalized(s).replace(/[\s\p{P}\p{S}]+/gu, ''); }
function boundedText(s, limit) { return typeof s === 'string' ? s.trim().slice(0, limit) : ''; }

// Author-programmed small neural-style linear router, never pretrained.
export class WeightRouter {
  constructor() {
    this.intents = [...INTENTS]; this.features = [...INTENTS];
    this.weights = this.intents.map((_,i) => this.features.map((__,j)=> i === j ? 4 : 0));
    this.history = [];
  }
  featuresOf(text) {
    const x = normalized(text);
    return this.features.map(k => Number(FEATURE_SETS[k].some(word =>
      word === 'hi' ? /\bhi\b/.test(x) : x.includes(word))));
  }
  predict(text) {
    const f = this.featuresOf(text);
    const scores = this.weights.map(row => row.reduce((s,w,j)=> s + w*f[j], 0));
    const max = Math.max(...scores);
    return {intent:max<=0?'unknown':this.intents[scores.indexOf(max)],scores,features:f};
  }
  edit(intent,feature,value) {
    const i = this.intents.indexOf(intent),j = this.features.indexOf(feature);
    if (i<0 || j<0 || !Number.isFinite(value) || Math.abs(value)>100) throw Error('Invalid WSP edit');
    const before=this.weights[i][j]; this.weights[i][j]=value;
    const patch={intent,feature,before,after:value}; this.history.push(patch);
    if(this.history.length>64)this.history.shift();
    return patch;
  }
  rollback() {
    const p=this.history.pop(); if(!p) return false;
    this.weights[this.intents.indexOf(p.intent)][this.features.indexOf(p.feature)] = p.before;
    return true;
  }
  snapshot() { return { weights:this.weights.map(r=>[...r]), history:this.history.map(p=>({...p})) }; }
  restore(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.weights) || snapshot.weights.length!==this.intents.length ||
       !snapshot.weights.every(r=>Array.isArray(r) && r.length===this.features.length &&
         r.every(n=>typeof n==='number' && Number.isFinite(n) && Math.abs(n)<=100))) return false;
    this.weights=snapshot.weights.map(r=>[...r]);
    // imported patch history cannot be trusted to represent the current weights
    const patches=Array.isArray(snapshot.history) ? snapshot.history : [];
    let valid=patches.length<=64;
    const trial=this.weights.map(r=>[...r]);
    for(let k=patches.length-1;k>=0 && valid;k--){
      const p=patches[k],i=this.intents.indexOf(p?.intent),j=this.features.indexOf(p?.feature);
      if(i<0||j<0||!Number.isFinite(p?.before)||!Number.isFinite(p?.after)||
         Math.abs(p.before)>100||Math.abs(p.after)>100||trial[i][j]!==p.after){valid=false;break;}
      trial[i][j]=p.before;
    }
    this.history=valid?patches.map(p=>({...p})):[];
    return true;
  }
}

// Expression parser without eval, Function or JavaScript interpretation.
export function calculate(input) {
  let s=normalized(input).replace(/[×x]/g,'*').replace(/÷/g,'/');
  s=s.replace(/^(?:計算(?:して|してください)?|calculate)\s*[：:]?\s*/u,'').trim();
  s=s.replace(/(?:は)?[？?]\s*$/u,'').trim();
  if (!s || s.length>120 || !/^[0-9.()\-+*/%\s]+$/.test(s)) return null;
  const parts=s.match(/(?:\d+\.?\d*|\.\d+)|[()+*/%-]/g);
  if(!parts || parts.length>100 || parts.join('').length!==s.replace(/\s/g,'').length) return null;
  let pos=0,depth=0;
  function expression() {
    let v=term();
    while(parts[pos]==='+'||parts[pos]==='-') { const op=parts[pos++],rhs=term();v=op==='+'?v+rhs:v-rhs; }
    return v;
  }
  function term() {
    let v=unary();
    while(parts[pos]==='*'||parts[pos]==='/'||parts[pos]==='%') {
      const op=parts[pos++],rhs=unary();if((op==='/'||op==='%')&&rhs===0)throw Error('zero division');
      v=op==='*'?v*rhs:op==='/'?v/rhs:v%rhs;
    }return v;
  }
  function unary() {
    if(++depth>48) throw Error('too deep');
    try {
      if(parts[pos]==='+'){pos++;return unary();}
      if(parts[pos]==='-'){pos++;return -unary();}
      if(parts[pos]==='('){pos++;const v=expression();if(parts[pos++]!==')')throw Error('parentheses');return v;}
      const token=parts[pos++];if(!token || !/^(?:\d+\.?\d*|\.\d+)$/.test(token))throw Error('number');
      return Number(token);
    }finally{depth--;}
  }
  try {
    const v=expression();
    if(pos!==parts.length || !Number.isFinite(v) || Math.abs(v)>1e15) return {error:'計算式の範囲外です。'};
    return {value:Number(v.toPrecision(13)).toString()};
  } catch(err) {return {error:err.message==='zero division'?'ゼロでは割れません。':'計算式を確認してください。'};}
}

// String similarity, not a learned semantic encoder. Abstains at low confidence.
export function similarity(a,b) {
  const x=questionKey(a), y=questionKey(b);
  if(!x || !y) return 0;
  if(x===y) return 1;
  if(Math.min(x.length,y.length)<5) return 0;
  const chunks = s => { const m=new Map();for(let i=0;i<s.length-1;i++){const t=s.slice(i,i+2);m.set(t,(m.get(t)||0)+1);}return m; };
  const aa=chunks(x), bb=chunks(y);let common=0;
  for(const [k,n] of aa) common+=Math.min(n,bb.get(k)||0);
  return (2*common)/((x.length-1)+(y.length-1));
}

export function findLesson(query, collection) {
  if(!Array.isArray(collection)) return null;
  const lessons=collection.filter(l=>l && typeof l.q==='string' && typeof l.a==='string');
  const exact=lessons.find(l=>questionKey(l.q)===questionKey(query));
  if(exact) return {lesson:exact,score:1};
  let best=null;
  for(const lesson of lessons) {
    const score=similarity(query,lesson.q);
    if(!best || score>best.score) best={lesson,score};
  }
  return best;
}

export function saveLesson(collection, q, a, max=200) {
  if(!Array.isArray(collection)) throw Error('Knowledge collection missing');
  q=boundedText(q,120);a=boundedText(a,1500);
  if(!q || !a) throw Error('質問と回答を入力してください。');
  const found=collection.find(l=>questionKey(l.q)===questionKey(q));
  if(found){ found.q=q;found.a=a;return 'updated'; }
  collection.push({q,a}); if(collection.length>max) collection.shift();return 'added';
}

function formatTasks(tasks) {
  if(!tasks.length) return 'タスクはありません。「/todo タスク内容」で追加できます。';
  return `タスク（${tasks.filter(t=>t.done).length}/${tasks.length}件完了）：\n`+
    tasks.map((t,i)=>`${i+1}. ${t.done?'☑':'☐'} ${t.text}`).join('\n');
}
function searchDocuments(query, documents) {
  const key=normalized(query);if(!key || key.length>80) return '検索語は1〜80文字で入力してください。';
  const matches=[];
  for(const doc of (documents||[])) {
    if(!doc || typeof doc.text!=='string') continue;
    const lines=doc.text.split(/\r?\n/);
    for(let i=0;i<lines.length;i++) {
      const line=lines[i].trim();
      if(normalized(line).includes(key)) matches.push({title:doc.title||'無題',line:i+1,text:line.slice(0,240)});
      if(matches.length>=6) break;
    }
    if(matches.length>=6) break;
  }
  return matches.length ? `資料中の一致箇所（文字列検索・最大6件）：\n${matches.map(m=>`・${m.title} ${m.line}行目：${m.text}`).join('\n')}` :
    `登録資料に「${query}」の文字列一致はありません。意味検索ではありません。`;
}

// Citation-oriented extractive search. Never fabricates answers beyond stored lines.
export function retrieveEvidence(query, documents, limit=4) {
  const q=questionKey(query);if(!q||q.length>100)return [];
  const terms=[...new Set(normalized(query).split(/[\s、，,。？！?:：]+/u).map(questionKey).filter(t=>t.length>=2))];
  const queryBigrams=new Set();for(let i=0;i<q.length-1;i++)queryBigrams.add(q.slice(i,i+2));
  const found=[];
  for(const doc of documents||[]){
    if(!doc || typeof doc.text!=='string')continue;
    const lines=doc.text.split(/\r?\n/);
    lines.forEach((line,i)=>{
      if(!line.trim())return;
      const key=questionKey(line);let overlap=0;
      for(const gram of queryBigrams)if(key.includes(gram))overlap++;
      const exact=terms.filter(t=>key.includes(t)).length;
      const score=3*exact+overlap/Math.max(2,queryBigrams.size);
      if((exact || overlap>=2) && score>=.35)found.push({title:doc.title,line:i+1,text:line.trim().slice(0,240),score});
    });
  }
  return found.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)||a.line-b.line).slice(0,limit);
}

export class SolZeroEngine {
  constructor(){this.router=new WeightRouter();this.bulk=null;this.flow=null;this.autoAudit=null;this.neural=new WeightSpaceNetwork();this.cognition=BANC_COGNITION;}
  reply(input, conversation={messages:[],notes:[]}, context={}) {
    const raw=String(input).trim(), x=normalized(raw);
    if(!raw)return '文章を入力してください。';
    const notes=conversation.notes || (conversation.notes=[]);
    const lessons=conversation.lessons || (conversation.lessons=[]);
    const tasks=conversation.tasks || (conversation.tasks=[]);
    const global=Array.isArray(context.knowledge)?context.knowledge:[];
    const documents=Array.isArray(context.documents)?context.documents:[];
    const generator=context.generator;
    if(/^\/(?:net|wspnet)(?:\s|$)/iu.test(raw)){
      const arg=raw.replace(/^\/(?:net|wspnet)\s*/iu,'').trim();
      const help='WSPを重みから学習：/net demo、/net train {JSON}、/net run [1.3]、/net status、/net undo。\nJSONのinputs/outputs/train/holdoutを指定。各訓練例は{"input":[数値],"output":[数値]}形式です。\n学習済み重みで推論する数値モデルであり、自由な自然言語理解は未実装です。';
      if(!arg||/^(help|ヘルプ|list)$/iu.test(arg))return help;
      if(arg==='status')return this.neural.model?
        '学習済みWSP重み行列：'+this.neural.parameters+'パラメータ、入力'+this.neural.model.inputs+'次元、隠れ'+this.neural.model.hidden+'、出力'+this.neural.model.outputs+'次元。':
        '未学習です。/net demo または /net train {JSON} を実行してください。';
      if(arg==='undo')return this.neural.rollback()?'WSP重みを前の学習結果へ戻しました。':'戻せる学習済み重みはありません。';
      if(arg.startsWith('run ')){
        try{return '学習済みWSP重み行列の推論出力：'+JSON.stringify(this.neural.run(JSON.parse(arg.slice(4))))+
          '\n※重みの積和と活性化による出力です。';}
        catch(err){return 'WSP推論拒否：'+err.message;}
      }
      if(arg==='demo'||arg.startsWith('train ')){
        try{
          if(arg.length>3000)throw Error('学習入力は3000文字以内');
          const report=trainAndVerifyNeural(arg==='demo'?NEURAL_DEMO:JSON.parse(arg.slice(6)));
          const grades='訓練 '+report.training.correct+'/'+report.training.total+
            '、独立未使用評価 '+report.validation.correct+'/'+report.validation.total+
            '、最大絶対誤差 '+report.validation.maxError.toPrecision(4);
          if(!report.accepted)return 'WSP学習不採用：'+grades+'。前の重みは保持しました。';
          promoteNeural(report,this.neural);
          return 'WSP重み学習・採用完了：'+report.parameters+'パラメータ、'+report.epochs+
            '回の更新。'+grades+' 合格。\n/net run [1.3] で推論できます。'+
            '\n※限定された数値例での合格であり、汎用知能の証明ではありません。';
        }catch(err){return 'WSP学習拒否：'+err.message;}
      }
      return help;
    }
    if(/^\/cognition(?:\s|$)/iu.test(raw)){
      const arg=raw.replace(/^\/cognition\s*/iu,'').trim();
      if(!arg||arg==='help')return 'BANC888認知検証（計画専用）：/cognition demo で例、/cognition {JSON} で計画を表示します。実行や端末の操作は行いません。学習WSPの重みとは別の機能です。';
      const demo={schema:1,facts:{state:'new'},goal:{state:'ready'},actions:[
        {id:'prepare',tool:'task.value',requires:{state:'new'},effects:{state:'draft'},args:{}},
        {id:'verify',tool:'task.value',requires:{state:'draft'},effects:{state:'ready'},args:{}}]};
      if(arg==='demo')return JSON.stringify(demo,null,2);
      if(arg.length>64000)return '認知計画拒否：JSONが長すぎます';
      try{
        if(!arg.startsWith('{'))return '認知計画拒否：実行せず、/cognition demo または /cognition {JSON} で計画を確認してください。';
        const report=this.cognition.plan(JSON.parse(arg));
        return 'BANC888認知計画（予測のみ、未実行）：'+JSON.stringify(report).slice(0,7000);
      }catch(e){return '認知計画拒否：'+String(e.message||e).slice(0,300);}
    }
    const exportMatch=raw.match(/^\/exportwsp(?:\s+(.+))?$/iu);
    if(exportMatch){
      if(!this.graph)return 'WSP数値回路がまだありません。先にWSPグラフを読み込んでください。';
      try{
        const result=generateWSPCode(this.graph.snapshot(),(exportMatch[1]||'').trim());
        return `［WSP数値回路を${result.language}へ変換：${result.nodes}ノード・${result.weights}重み］\nファイル名：${result.filename}\n\n${result.code}\n\n※単独実行可能な関数ですが、ブラウザのチャット内ではコード実行しません。WSP回路画面からファイルとして書き出せます。`;
      }catch(e){return 'WSPコード出力を拒否：'+e.message;}
    }
    const codeArtifact=generateCode(raw);
    if(codeArtifact)return codeArtifact.message;
    if(/^\/induce(?:\s|$)/iu.test(raw)){
      if(!this.graph)return '帰納WSPは未接続です。';
      const arg=raw.replace(/^\/induce\s*/iu,'').trim();
      if(!arg||arg==='status')return `現在のWSP数値回路：${this.graph.spec.name}。\n例からの新規回路は上部の『帰納WSP』画面で訓練例と独立評価例を分けて合成してください。`;
      if(arg==='undo')return this.graph.rollback()?'帰納WSP回路を元に戻しました（保存は画面で実行）。':'元に戻せる回路はありません。';
      try{const values=arg.split(/[,，\s]+/).map(Number);if(values.length!==this.graph.spec.inputs.length||!values.every(Number.isFinite))return '入力の次元が一致しません。';
        const result=Object.values(this.graph.run(values).outputs).flat();
        return `現在のWSPグラフの数値出力：${result.join(', ')}\n※規則推定は例示された演算候補に限定されます。`;
      }catch(e){return '回路実行拒否：'+e.message;}
    }
    if(/^\/(?:intent|learner)(?:\s|$)/iu.test(raw)){
      if(/^\/learner(?:\s|$)/iu.test(raw)) return `スクラッチ学習済み分類器：${LEARNED_ROUTER_META.parameters}パラメータ、6分類。\n独立テンプレート324件で287件正解（88.6%）。自由回答の知能ではありません。\n使い方：/intent 資料を検索してください`; 
      const phrase=raw.replace(/^\/intent\s*/iu,'').trim();
      if(!phrase)return '使い方：/intent タスクを追加してください';
      const p=predictLearnedIntent(phrase);
      return `学習済み重みの分類：${p.label}（確信度 ${(100*p.confidence).toFixed(1)}%）${p.uncertain?'［判定保留］':''}\nこれは候補提示のみで、操作は実行しません。`;
    }
    if(/^\/auto(?:\s|$)/iu.test(raw)){
      const a=this.autoAudit;return a?`WSP自動設計（直近）：${a.decision} / ${a.rules}ルール、独立評価 ${a.validCorrect}/${a.validTotal}。\n上部の『自動設計』画面で訓練例から新しい回路を作れます。`:
        'WSP自動設計：上部『自動設計』で例を入力し、独立検証に合格した回路のみ採用できます。';
    }
    // These commands manipulate directly compiled WSP numeric circuits.
    if(/^\/flow(?:\s|$)/iu.test(raw)){
      if(!this.flow)return '状態機械は未設定です。';
      const arg=raw.replace(/^\/flow\s*/iu,'').trim();
      if(!arg || arg==='status'){
        const s=this.flow.stats();return `状態遷移回路：現在「${this.flow.state}」 / ${s.states}状態、${s.transitions}遷移、${s.edges}重み接続。\n外部操作は行わず、行動案だけ表示します。`;
      }
      if(arg==='back')return this.flow.rewind()?'前の状態へ戻しました。':'前の状態へ戻せません。';
      if(arg==='demo')return '「WSP拡張」画面の状態機械サンプルを読み込み、コンパイルしてください。';
      if(arg.startsWith('event ')){
        const r=this.flow.step(arg.slice(6).trim());return r.matched?`状態：${r.before} → ${r.state}\n行動案：${r.action}\n［WSP遷移ニューロン ${r.neuron}］`:r.error;
      }
      return '使用例：/flow、/flow event 開始、/flow back';
    }
    if(/^\/wsp(?:\s|$)/iu.test(raw)){
      if(!this.bulk)return 'WSP回路は現在使用できません。';
      const arg=raw.replace(/^\/wsp\s*/iu,'').trim();
      if(!arg||arg==='status'){
        const st=this.bulk.stats();return `WSP回路：${st.rules}ルール、${st.neurons}ニューロン、${st.features}入力特徴、${st.edges}接続。\n数値回路の容量：${st.numericBytes}バイト、保存JSON：${st.serializedBytes}バイト。\nこれは直接設定した重み回路であり、学習済み言語知能ではありません。`;
      }
      if(arg==='list')return this.bulk.rules.length?this.bulk.rules.slice(0,30).map(r=>`${r.id}：${[...r.all,...r.any].join(' + ')}${r.not.length?' / 否定:'+r.not.join(', '):''}`).join('\n'):'WSPルールはありません。';
      if(arg==='undo')return this.bulk.restorePreviousRules()?'直前のルール一括変更を取り消しました。':'取り消す一括変更はありません。';
      if(arg==='rollback')return this.bulk.rollbackWeight()?'直前の重み編集を元に戻しました。':'取り消せる重み編集はありません。';
      if(arg.startsWith('trace ')){
        const d=this.bulk.infer(arg.slice(6),{trace:true});
        return d.match?`WSP発火：${d.match.rule} / ニューロン ${d.match.neuron}\n${d.fired.map(m=>`${m.rule} (activation=${m.activation}, priority=${m.priority})`).join('\n')}`:'WSP回路は該当なしです。';
      }
      if(arg.startsWith('del ')){try{const out=this.bulk.deleteRule(arg.slice(4).trim());return `削除しました。${out.rules}ルールです。`;}catch(e){return `WSP拒否：${e.message}`;}}
      if(arg.startsWith('add ')){
        const m=arg.slice(4).match(/^(.{1,500}?)\s*=>\s*(.{1,1200})$/us);
        if(!m)return '形式：/wsp add キーワード & !除外ワード => 応答';
        const terms=m[1].split('&').map(x=>x.trim()).filter(Boolean), all=terms.filter(x=>!x.startsWith('!')),not=terms.filter(x=>x.startsWith('!')).map(x=>x.slice(1));
        try{const r={id:'r_'+Date.now().toString(36)+'_'+(this.bulk.rules.length+1),all,not,response:m[2]};const out=this.bulk.addRule(r);return `WSPコンパイル完了：${out.rules}ルール、${out.neurons}ニューロン、${out.edges}接続。`;}
        catch(e){return `WSP拒否：${e.message}`;}
      }
      return '使用例：/wsp、/wsp list、/wsp add 計画 & !中止 => 手順を整理します、/wsp trace 計画、/wsp undo、/wsp rollback';
    }

    const teach=raw.match(/^(教える|学習|\/teach|\/global)\s*[:：]?\s*(.*?)\s*(?:=>|→)\s*(.+)$/u);
    if(teach) {
      const g=teach[1]==='/teach'||teach[1]==='/global';const q=teach[2].trim(),a=teach[3].trim();
      if(!q||!a||q.length>120||a.length>1500)return '質問は120文字以内、回答は1500文字以内にしてください。';
      saveLesson(g?global:lessons,q,a,g?200:100);
      return `${g?'共有知識':'この会話'}に回答を登録しました。\n質問：${q}\n※これは登録した回答を検索して返す方式で、言語モデルの追加学習ではありません。`;
    }
    if(/^(?:学習一覧|教えたこと)$/u.test(raw)) return lessons.length?lessons.map((l,i)=>`${i+1}. ${l.q}`).join('\n'):'この会話の登録回答はありません。「教える：質問 => 回答」で追加できます。';
    if(/^(?:\/knowledge|共有知識一覧)$/u.test(x))return global.length?`共有知識 ${global.length}件：\n${global.map((l,i)=>`${i+1}. ${l.q}`).join('\n')}`:'共有知識はありません。知識パネル、または「/teach 質問 => 回答」から登録できます。';
    const del=raw.match(/^(?:学習削除|教えたことを削除|\/forget)\s*[:：]?\s*(.+)$/u);
    if(del){const i=lessons.findIndex(l=>questionKey(l.q)===questionKey(del[1]));if(i<0)return 'この会話に一致する学習回答はありません。';lessons.splice(i,1);return '登録した回答を削除しました。';}
    const correction=raw.match(/^(?:修正|\/correct)\s*[:：]\s*(.+)$/u);
    if(correction){
      const previous=(conversation.messages||[]).filter(m=>m.role==='user').at(-1);
      if(!previous)return '訂正対象がありません。直前に質問した後で「修正：正しい回答」と入力してください。';
      if(correction[1].trim().length>1500)return '回答は1500文字以内にしてください。';
      saveLesson(global,previous.text,correction[1].trim());
      return `直前の質問を共有知識へ登録しました。\n質問：${previous.text.slice(0,120)}\n※回答の正しさは自動検証していません。`;
    }
    const learned=findLesson(raw,lessons), shared=findLesson(raw,global);
    const match=[learned&&{...learned,scope:'この会話'},shared&&{...shared,scope:'共有知識'}]
      .filter(Boolean).sort((a,b)=>b.score-a.score)[0];
    if(match && match.score>=0.80) {
      return `${match.lesson.a}${match.score<1?`\n\n［登録された類似質問「${match.lesson.q}」から検索：一致度 ${Math.round(match.score*100)}%］`:''}`;
    }

    if(/^(?:\/help|ヘルプ|使い方)$/u.test(x))return this.help();
    const note=raw.match(/^(?:覚えて|記憶して|メモして)(?:おいて)?\s*[:：]\s*(.+)$/u);
    if(note){const value=note[1].trim();if(value.length>500)return 'メモは500文字以内にしてください。';notes.push(value);if(notes.length>100)notes.shift();return `この会話のメモに保存しました：${value}\n※この端末のブラウザ内に保存します。`;}
    const forget=raw.match(/^(?:忘れて|メモ削除)\s*[:：]\s*(.+)$/u);
    if(forget){const i=notes.findIndex(n=>n===forget[1].trim());if(i<0)return '一致するメモがありません。';notes.splice(i,1);return 'メモを削除しました。';}
    if(/^(覚えていること|メモ一覧|記憶一覧|何を覚えている[？?]?)$/u.test(raw))return notes.length?`メモ（${notes.length}件）：\n${notes.map((n,i)=>`${i+1}. ${n}`).join('\n')}`:'メモはありません。「覚えて：内容」で追加できます。';

    const addTask=raw.match(/^(?:\/todo|タスク追加)\s*[:：]?\s*(.+)$/u);
    if(addTask){if(addTask[1].trim().length>160)return 'タスクは160文字以内で指定してください。';tasks.push({text:addTask[1].trim(),done:false});if(tasks.length>100)tasks.shift();return `タスクを追加しました（${tasks.length}件目）。`;}
    if(/^(?:\/tasks|タスク一覧|やること一覧)$/u.test(x))return formatTasks(tasks);
    const action=raw.match(/^\/(done|undo|deltask)\s+(\d{1,3})$/u);
    if(action){const i=Number(action[2])-1;if(i<0||i>=tasks.length)return '指定した番号のタスクはありません。';
      if(action[1]==='deltask')tasks.splice(i,1);else tasks[i].done=action[1]==='done';return formatTasks(tasks);}
    if(/^(?:\/docs|資料一覧)$/u.test(x))return documents.length?`登録資料（${documents.length}件）：\n${documents.map((d,i)=>`${i+1}. ${d.title}`).join('\n')}`:'登録資料がありません。資料パネルから .txt/.md を追加できます。';
    const docSearch=raw.match(/^(?:\/search|\/find|資料検索)\s*[:：]?\s*(.+)$/u);
    if(docSearch)return searchDocuments(docSearch[1].trim(),documents);
    const ask=raw.match(/^\/(?:ask|evidence)\s+(.+)$/u);
    if(ask){
      const items=retrieveEvidence(ask[1],documents);
      return items.length ? '資料中の関連候補（引用・行番号つき。正答の生成ではありません）：\n'+
        items.map(m=>`・［${m.title} ${m.line}行目］ ${m.text}`).join('\n') :
        '十分に関連する資料の行を見つけられませんでした。推測では回答しません。';
    }
    if(/^\/model(?:stats)?$/u.test(x))return generator?.steps?
      `スクラッチ文字予測モデル：${generator.size}文字、${generator.size**2}重み、学習更新 ${generator.steps}回。\n※1文字先を予測するだけで、会話理解は未実装です。`:
      'まだ文字予測モデルの学習はありません。上部の「生成実験」で文章を学習してください。';
    const generate=raw.match(/^\/generate(?:\s+(.+))?$/u);
    if(generate){
      if(!generator?.steps)return 'まだ学習していません。「生成実験」パネルで学習してください。';
      return '［実験的な文字予測・内容の正確性は保証されません］\n'+generator.generate(generate[1]||'',100);
    }

    if(/^(履歴|直前の話|さっき何の話|会話を振り返って|要約して)/u.test(x)){
      const users=(conversation.messages||[]).filter(m=>m.role==='user').slice(-5);
      return users.length?`直近の発言（自動要約ではなく抜粋）：\n${users.map((m,i)=>`${i+1}. ${m.text.slice(0,100)}`).join('\n')}`:'まだ発言がありません。';
    }
    if(/^(?:日付|今何時|いま何時|現在時刻|今日の日付)/u.test(x))return `端末の日時：${new Date().toLocaleString('ja-JP')}\n※端末時計から取得しています。`;
    if(/^(?:\/count|文字数)\s*[:：]?\s*.+/u.test(raw)) {
      const text=raw.replace(/^(?:\/count|文字数)\s*[:：]?\s*/u,'');
      return `文字数：${[...text].length}文字、UTF-8：${new TextEncoder().encode(text).length}バイト。`;
    }
    const plausibleMath=/^[\s\d.+*/%()\-×÷x]+(?:は[？?]?|[？?])?$/u.test(x)||/^(?:計算(?:して|してください)?|calculate)\s*[：:]?\s*/u.test(x);
    if(plausibleMath){const result=calculate(raw);return result?(result.error||`計算結果：${result.value}`):'式を解析できません。例：「計算して (12+8)/4」';}
    // Exact, trained or stored Q&A takes precedence. WSP is a separate numeric fallback.
    if(this.bulk){const compiled=this.bulk.infer(raw);if(compiled.match)return `［WSP直接構築回路：${compiled.match.rule}］\n${compiled.match.response}`;}
    const {intent}=this.router.predict(raw);
    switch(intent){
      case 'greeting':return 'こんにちは。Sol-Zeroです。既存の学習済みAIを使わないチャット試作版です。質問を教えると、次回から検索して回答できます。';
      case 'identity':return '私はSol-Zero v0.15です。既存の学習済みモデルは使用していません。直接設定した重みの分類回路、計算器、メモ、登録知識と資料の文字列検索を組み合わせています。自由な高度推論は未実装です。';
      case 'help':return this.help();
      case 'gratitude':return 'どういたしまして。';
      case 'code':return codeHelp();
      case 'reasoning':return '未知の問題に対する一般推論は未実装です。式の計算や、登録した資料の文字列検索なら実行できます。';
      case 'multimodal':return '画像・音声・GIF・WebMの手続き的生成は「メディア工房」または /image、/audio、/video、/webm から使えます。画像や動画の内容理解、高品質な学習生成モデルは未実装です。';
      case 'casual':return '会話履歴、タスク、メモ、登録した回答を使えます。一般的な自由回答能力はまだ学習されていません。';
      default:
        if(raw.length>=5){const p=predictLearnedIntent(raw);
          if(p.confidence>=.72)return `学習済み重みの意図候補：${p.label}（確信度 ${(p.confidence*100).toFixed(1)}%）。\nこれは6種類の指示分類であり、一般的な問題の回答ではありません。\n/intent 文章 で明示的に確認できます。`;}
        return match && match.score>=0.60 ? `登録された関連質問は「${match.lesson.q}」です（一致度 ${Math.round(match.score*100)}%）。\n同じ質問として答えるには、質問文を合わせてください。`:
          '入力は受け取りました。ただし、未知の一般質問にはまだ自由回答できません。「/help」で対応機能を確認するか、知識パネルで質問と回答を登録してください。';
    }
  }
  help(){return `Sol-Zero v${ENGINE_VERSION}（ローカル試作）\n・BANC888認知計画：「/cognition demo」「/cognition {JSON}」（予測のみ）\n・WSP新規学習：「/net demo」「/net train {JSON}」「/net run [1.3]」「/net undo」\n・計算：「計算して (12+8)/4」\n・覚える：「覚えて：内容」／「覚えていること」\n・会話内Q&A：「教える：質問 => 回答」\n・全会話共通Q&A：「/teach 質問 => 回答」\n・直前の回答を訂正：「修正：正しい回答」\n・共有知識：「/knowledge」\n・タスク：「/todo 内容」→「/tasks」→「/done 1」\n・資料：「/docs」「/search 検索語」（文字列一致）
・関連する資料の行を抜粋：「/ask 質問」（根拠候補）
・数値例からWSP回路を帰納合成：「/induce」「/induce 2,3」（画面「帰納WSP」）\n・問題例からWSP回路を自動設計：「/auto」（画面で作成と独立検証）\n・WSP状態遷移：「/flow」「/flow event 開始」「/flow back」\n・WSP大量回路：「/wsp」「/wsp add キーワード & !除外 => 応答」「/wsp trace 質問」「/wsp undo」\n・スクラッチ学習による指示分類：「/intent 質問」「/learner」\n・文字予測実験：「/model」「/generate 書き出し」\n・WSP回路をコードに変換：「/exportwsp python」「/exportwsp javascript」\n・タスク工房：「/agent help」「/agent demo」／上部「タスク工房」で最大16工程を連結\n・コード生成：「/code python fibonacci」「/code javascript binary_search」（検証済み固定アルゴリズム）\n・画像/音声/動画：「/image 海」「/audio 波」「/video 星」「/webm 街」\n・文字数：「/count 文字列」\n・履歴／日時\n・画面から履歴検索、JSONバックアップ・復元、テキスト出力、回路編集\n※登録回答の検索・ルール・実験用文字予測を組み合わせています。一般推論・画像理解は未搭載です。`;}
}
