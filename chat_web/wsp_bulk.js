/** Sol-Zero WSP v0.6: compile symbolic conjunctions into sparse numeric neuron weights.
 * No pretrained weights, APIs, automatic language understanding or gradient training.
 * Each rule becomes one or more ReLU threshold neurons:
 *   a = max(0, bias + sum(w_j * x_j)), bias = 1 - num_positive_features,
 *   w_positive=1, w_negative=-1, x_j=1 when literal input feature is present.
 */
export const WSP_MAX_RULES = 4096;
export const WSP_MAX_NEURONS = 16384;
export const WSP_MAX_EDGES = 300000;
const keyOf=x=>String(x).normalize('NFKC').trim().toLowerCase();
const BYTES = new TextEncoder();
function strings(x,cap,label){
  if(!Array.isArray(x)||x.length>cap)throw Error(`${label} は配列（最大${cap}件）にしてください。`);
  const values=x.map(k=>{if(typeof k!=='string')throw Error(`${label}に文字列以外があります。`);
    const v=keyOf(k);if(!v||v.length>80)throw Error(`${label}の各条件は1〜80文字です。`);return v;});
  if(new Set(values).size!==values.length)throw Error(`${label}に重複があります。`);
  return values;
}
function cleanRule(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('ルールはオブジェクト形式です。');
  if(typeof raw.id!=='string'||!/^[-_\p{L}\p{N}]{1,60}$/u.test(raw.id))throw Error('idは1〜60文字の英数字等で指定してください。');
  if(typeof raw.response!=='string'||!raw.response.trim()||raw.response.length>1200)throw Error('responseは1〜1200文字です。');
  const all=strings(raw.all??[],12,'all');const any=strings(raw.any??[],8,'any');const not=strings(raw.not??[],8,'not');
  if(!all.length&&!any.length)throw Error('allかanyに少なくとも1つ条件が必要です。');
  if([...all,...any].some(x=>not.includes(x)))throw Error('肯定と否定で同じ条件は使えません。');
  const exact=raw.exact===true;
  if(exact&&(!all.length||any.length||all.length!==1||not.length))throw Error('exactルールはallを1条件だけ指定します。');
  const priority=raw.priority===undefined?0:raw.priority;
  if(!Number.isInteger(priority)||priority< -100||priority>100)throw Error('priorityは-100〜100の整数です。');
  return {id:raw.id,all,any,not,exact,priority,response:raw.response.trim()};
}
function compileRules(rawRules){
  if(!Array.isArray(rawRules)||rawRules.length>WSP_MAX_RULES)throw Error(`ルールは最大${WSP_MAX_RULES}件です。`);
  const rules=rawRules.map(cleanRule), seen=new Set();
  for(const rule of rules){if(seen.has(rule.id))throw Error(`ID重複：${rule.id}`);seen.add(rule.id);}
  const keys=[],keyIndex=new Map(),segments=[],assign=[];let edgeCount=0;
  function keyIndexOf(k){if(!keyIndex.has(k)){keyIndex.set(k,keys.length);keys.push(k);}return keyIndex.get(k);}
  for(let i=0;i<rules.length;i++){
    const rule=rules[i],alternatives=rule.any.length?rule.any:[null];
    for(const option of alternatives){
      const positives=rule.exact?['='+rule.all[0]]:[...rule.all,...(option?[option]:[])];
      const negatives=rule.not;
      const edges=[...positives.map(k=>[keyIndexOf(k),1]),...negatives.map(k=>[keyIndexOf(k),-1])];
      segments.push(edges);assign.push({ruleIndex:i,bias:1-positives.length,specificity:positives.length+negatives.length});
      edgeCount+=edges.length;
      if(segments.length>WSP_MAX_NEURONS||edgeCount>WSP_MAX_EDGES)throw Error('回路規模上限を超えました。');
    }
  }
  const offsets=new Uint32Array(segments.length+1),cols=new Uint32Array(edgeCount),weights=new Int8Array(edgeCount),biases=new Int8Array(segments.length),toRules=new Uint16Array(segments.length),specificity=new Uint8Array(segments.length);
  let cursor=0;
  segments.forEach((edges,i)=>{offsets[i]=cursor;biases[i]=assign[i].bias;toRules[i]=assign[i].ruleIndex;specificity[i]=assign[i].specificity;
    for(const [col,value] of edges){cols[cursor]=col;weights[cursor]=value;cursor++;}});
  offsets[segments.length]=cursor;
  return {rules,keys,keyIndex,offsets,cols,weights,biases,toRules,specificity};
}
export class WSPBulk {
  constructor(){this.rules=[];this.keys=[];this.keyIndex=new Map();this.offsets=new Uint32Array([0]);this.cols=new Uint32Array(0);this.weights=new Int8Array(0);this.biases=new Int8Array(0);this.toRules=new Uint16Array(0);this.specificity=new Uint8Array(0);this.patches=[];this.previous=null;}
  replaceRules(input){
    // Atomic compile; on invalid input neither rules nor running weights are modified.
    const c=compileRules(input);
    const old=this.snapshot();this.previous=old;
    Object.assign(this,c);this.patches=[];
    return this.stats();
  }
  addRule(rule){this.replaceRules([...this.rules,rule]);return this.stats();}
  deleteRule(id){if(!this.rules.some(r=>r.id===id))throw Error('指定したルールIDがありません。');this.replaceRules(this.rules.filter(r=>r.id!==id));return this.stats();}
  restorePreviousRules(){if(!this.previous)return false;const backup=this.previous;const compiled=compileRules(backup.rules);Object.assign(this,compiled);this.patches=[];
    for(const p of backup.patches||[])this.editWeight(p.neuron,p.feature,p.after);
    this.previous=null;return true;
  }
  featuresOf(input){
    const text=keyOf(input),x=new Uint8Array(this.keys.length);
    for(let i=0;i<this.keys.length;i++){
      const key=this.keys[i];x[i]=Number(key[0]==='='?text===key.slice(1):text.includes(key));
    }
    return x;
  }
  infer(input,{trace=false}={}){
    if(!this.rules.length)return {match:null,fired:[],activeFeatures:0};
    const x=this.featuresOf(input),fired=[];let active=0;for(const v of x)active+=v;
    for(let n=0;n<this.biases.length;n++){
      let z=this.biases[n];for(let k=this.offsets[n];k<this.offsets[n+1];k++)z+=this.weights[k]*x[this.cols[k]];
      const activation=Math.max(0,z);if(activation>0){const r=this.rules[this.toRules[n]];
        fired.push({rule:r.id,response:r.response,priority:r.priority,specificity:this.specificity[n],neuron:n,activation});}
    }
    fired.sort((a,b)=>b.priority-a.priority||b.specificity-a.specificity||a.neuron-b.neuron);
    return {match:fired[0]||null,fired:trace?fired.slice(0,15):[],activeFeatures:active};
  }
  editWeight(neuron,feature,newValue){
    if(!Number.isInteger(neuron)||neuron<0||neuron>=this.biases.length)throw Error('ニューロン番号が不正です。');
    const index=this.keyIndex.get(keyOf(feature));if(index===undefined)throw Error('その特徴量がありません。');
    if(!Number.isInteger(newValue)||newValue< -5||newValue>5)throw Error('重みは-5〜5の整数です。');
    let edge=-1;for(let k=this.offsets[neuron];k<this.offsets[neuron+1];k++)if(this.cols[k]===index){edge=k;break;}
    if(edge<0)throw Error('そのニューロンに特徴量への接続がありません。');
    const before=this.weights[edge];this.weights[edge]=newValue;
    const patch={neuron,feature:this.keys[index],before,after:newValue};this.patches.push(patch);
    if(this.patches.length>256)this.patches.shift();return patch;
  }
  rollbackWeight(){const p=this.patches.at(-1);if(!p)return false;
    const index=this.keyIndex.get(p.feature);let edge=-1;
    for(let k=this.offsets[p.neuron];k<this.offsets[p.neuron+1];k++)if(this.cols[k]===index){edge=k;break;}
    if(edge<0||this.weights[edge]!==p.after)throw Error('重みが変更されており、撤回を中止しました。');
    this.weights[edge]=p.before;this.patches.pop();return true;
  }
  snapshot(){return {rules:this.rules.map(r=>({...r,all:[...r.all],any:[...r.any],not:[...r.not]})),patches:this.patches.map(p=>({...p}))};}
  restore(s){if(!s||!Array.isArray(s.rules)||!Array.isArray(s.patches)||s.patches.length>256)return false;
    try{const tmp=new WSPBulk();tmp.replaceRules(s.rules);tmp.previous=null;
      for(const p of s.patches){const change=tmp.editWeight(p.neuron,p.feature,p.after);
        if(change.before!==p.before)throw Error('パッチ履歴が一致しません。');}
      const c={rules:tmp.rules,keys:tmp.keys,keyIndex:tmp.keyIndex,offsets:tmp.offsets,cols:tmp.cols,weights:tmp.weights,biases:tmp.biases,toRules:tmp.toRules,specificity:tmp.specificity,patches:tmp.patches,previous:null};
      Object.assign(this,c);return true;
    }catch{return false;}
  }
  stats(){
    const numericBytes=this.offsets.byteLength+this.cols.byteLength+this.weights.byteLength+this.biases.byteLength+this.toRules.byteLength+this.specificity.byteLength;
    const textBytes=BYTES.encode(JSON.stringify(this.snapshot())).byteLength;
    return {rules:this.rules.length,neurons:this.biases.length,features:this.keys.length,edges:this.weights.length,numericBytes,serializedBytes:textBytes,patches:this.patches.length};
  }
}
export const WSP_DEMO_RULES = [
 {id:'demo_plan',all:['計画','手順'],not:['不要'],response:'手順の整理：①目標を明確化 ②作業を分割 ③各工程の合格条件を決める ④実行・検証。これは固定回路の回答です。',priority:4},
 {id:'demo_debug',all:['エラー'],any:['調査','原因','修正'],response:'エラー調査：再現手順、発生時刻、入力、期待動作、実際の動作を記録してください。',priority:4},
 {id:'demo_wsp',all:['wsp'],any:['仕組み','何'],response:'WSPとは重みを直接設計・編集する手法です。この画面では条件を疎な数値重み回路に変換します。',priority:3},
 {id:'demo_math',all:['数学','検証'],response:'数学の検証では、入力の前提、式変形、数値計算、境界条件を別々に確認します。',priority:3},
 {id:'demo_limits',all:['sol-zero','限界'],response:'Sol-Zeroは学習済みLLMを使っていません。条件一致と小さな文字予測の実験であり、Sol級の汎用知能ではありません。',priority:5},
 {id:'demo_safety',all:['削除','確認'],response:'削除対象と復元手段を確認し、不可逆操作は承認後に行ってください。',priority:3},
];
export function syntheticRules(n){
  if(!Number.isInteger(n)||n<1||n>WSP_MAX_RULES)throw Error('規模は1〜4096件です。');
  return Array.from({length:n},(_,i)=>({id:`synthetic_${String(i).padStart(4,'0')}`,all:[`検証キー${String(i).padStart(4,'0')}`],response:`検証値${i}`}));
}
