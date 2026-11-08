/** Sol-Zero v0.11: bounded example-driven numeric WSP induction.
 * No pretrained models, no eval, no data transfer, no use of the holdout to fit/select.
 * Fitted numeric coefficients are written into WSPGraph.linear weights.
 * A private promotion token rejects forged or mutated reports.
 */
import {WSPGraph,inspectGraph} from './wsp_graph.js';

export const INDUCTION_LIMITS=Object.freeze({dimensions:3,trainMax:128,holdoutMax:128,minTrain:6,minHoldout:4,absInput:10000,absOutput:1000000,probeCount:216});
const verified=new WeakMap();
const near=(a,b)=>Math.abs(a-b)<=1e-6*Math.max(1,Math.abs(a),Math.abs(b));
const fail=message=>{throw Error(message);};
const numeric=(x,bound)=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=bound;
const copy=x=>JSON.parse(JSON.stringify(x));
function rows(raw,n,label,min,max){
  if(!Array.isArray(raw)||raw.length<min||raw.length>max)fail(`${label}は${min}〜${max}件必要です`);
  return raw.map((r,i)=>{
    if(!r||!Array.isArray(r.input)||r.input.length!==n||!r.input.every(x=>numeric(x,INDUCTION_LIMITS.absInput))||!numeric(r.output,INDUCTION_LIMITS.absOutput))fail(`${label} ${i+1} の入力・正解は有限な数値で指定してください`);
    return {input:[...r.input],output:r.output};
  });
}
export function validateInduction(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('入力はJSONオブジェクトにしてください');
  const names=raw.inputs;
  if(!Array.isArray(names)||names.length<1||names.length>INDUCTION_LIMITS.dimensions||!names.every(x=>typeof x==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(x))||new Set(names).size!==names.length)fail('入力名は英数字で1〜3個、重複不可です');
  const train=rows(raw.train,names.length,'訓練例',INDUCTION_LIMITS.minTrain,INDUCTION_LIMITS.trainMax);
  const holdout=rows(raw.holdout,names.length,'未使用の評価例',INDUCTION_LIMITS.minHoldout,INDUCTION_LIMITS.holdoutMax);
  const seen=new Set();
  for(const [part,items] of [['train',train],['holdout',holdout]])for(const r of items){
    const key=JSON.stringify(r.input);
    if(seen.has(key))fail('同一入力の重複または訓練例と評価例の重複があります');
    seen.add(key);
  }
  return {inputs:[...names],train,holdout};
}
function constant(value){return {op:'constant',value:[value]};}
function linear(names,w,b=0){return {op:'linear',from:names,weights:[w],bias:[b]};}
function unary(from,op){return {op,from:[from]};}
function binary(from,op){return {op,from};}
function candidate(n,id,nodes,score){
  // Operators in graph are hand-written WSP instructions, not existing pretrained model knowledge.
  return {id,nodes,complexity:score};
}
function fixedCandidates(names){
  const n=names.length,ret=[];
  const lin=(i,a=1)=>linear(names,names.map((_,j)=>j===i?a:0));
  for(let i=0;i<n;i++){
    ret.push(candidate(n,`x${i}`, [{id:'out',...lin(i)}],1));
    ret.push(candidate(n,`negative${i}`,[{id:'out',...lin(i,-1)}],2));
    ret.push(candidate(n,`abs${i}`,[{id:'base',...lin(i)},{id:'out',...unary('base','abs')}],3));
    ret.push(candidate(n,`square${i}`,[{id:'base',...lin(i)},{id:'out',...unary('base','square')}],3));
  }
  if(n>=2){
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      const a=names[i],b=names[j];
      const withDiff=(w)=>[{id:'base',...linear(names,names.map((_,k)=>k===i?w:k===j?-w:0))}];
      ret.push(candidate(n,`sum${i}${j}`,[{id:'out',...binary([a,b],'add')}],2));
      ret.push(candidate(n,`product${i}${j}`,[{id:'out',...binary([a,b],'multiply')}],3));
      ret.push(candidate(n,`max${i}${j}`,[{id:'out',...binary([a,b],'maximum')}],3));
      ret.push(candidate(n,`min${i}${j}`,[{id:'out',...binary([a,b],'minimum')}],3));
      ret.push(candidate(n,`average${i}${j}`,[{id:'out',...binary([a,b],'mean')}],3));
      ret.push(candidate(n,`difference${i}${j}`,[{id:'out',...linear(names,names.map((_,k)=>k===i?1:k===j?-1:0))}],2));
      ret.push(candidate(n,`difference${j}${i}`,[{id:'out',...linear(names,names.map((_,k)=>k===j?1:k===i?-1:0))}],2));
      ret.push(candidate(n,`absoluteDifference${i}${j}`,[...withDiff(1),{id:'out',...unary('base','abs')}],3));
      ret.push(candidate(n,`squareDifference${i}${j}`,[...withDiff(1),{id:'out',...unary('base','square')}],4));
      ret.push(candidate(n,`positiveDifference${i}${j}`,[...withDiff(1),{id:'out',...unary('base','relu')}],3));
      ret.push(candidate(n,`positiveDifference${j}${i}`,[...withDiff(-1),{id:'out',...unary('base','relu')}],3));
    }
  }
  return ret;
}
function solveLinear(a,b){
  const n=b.length,m=a.map((row,i)=>[...row,b[i]]);
  for(let c=0;c<n;c++){
    let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
    if(Math.abs(m[pivot][c])<1e-9)return null;
    [m[c],m[pivot]]=[m[pivot],m[c]];
    const d=m[c][c];for(let k=c;k<=n;k++)m[c][k]/=d;
    for(let r=0;r<n;r++)if(r!==c){const factor=m[r][c];for(let k=c;k<=n;k++)m[r][k]-=factor*m[c][k];}
  }
  const w=m.map(r=>r[n]);return w.every(v=>numeric(v,10000))?w:null;
}
function affineFromTrain(names,train){
  const p=names.length+1,ata=Array.from({length:p},()=>Array(p).fill(0)),aty=Array(p).fill(0);
  for(const r of train){const v=[...r.input,1];for(let i=0;i<p;i++){aty[i]+=v[i]*r.output;for(let j=0;j<p;j++)ata[i][j]+=v[i]*v[j];}}
  const fit=solveLinear(ata,aty);
  if(!fit)return null;
  // Tighten floating noise in displayed coefficients; arbitrary coefficients remain allowed.
  const coeff=fit.map(x=>Math.abs(x-Math.round(x))<1e-8?Math.round(x):Number(x.toPrecision(12)));
  return candidate(names.length,'fitted_affine',[{id:'out',...linear(names,coeff.slice(0,-1),coeff.at(-1))}],4);
}
function graphFor(c,names){return {name:`WSP induction: ${c.id}`,inputs:[...names],nodes:c.nodes.map(n=>({...n})),outputs:['out']};}
function scoreCandidate(c,names,items){
  try{
    const g=new WSPGraph(graphFor(c,names));
    return {correct:items.filter(r=>near(g.run(r.input).outputs.out[0],r.output)).length,total:items.length};
  }catch{return {correct:0,total:items.length};}
}
function probes(n){
  const values=[-3,-1,0,1,2,5],out=[];
  const iter=(r)=>{if(r.length===n){out.push(r);return;}for(const v of values)iter([...r,v]);};iter([]);return out;
}
function distinguish(candidates,names){
  const pool=probes(names.length);
  const first=new WSPGraph(graphFor(candidates[0],names));
  for(const p of pool){const a=first.run(p).outputs.out[0];for(let j=1;j<candidates.length;j++){
    const b=new WSPGraph(graphFor(candidates[j],names)).run(p).outputs.out[0];
    if(!near(a,b))return {input:p,options:[{rule:candidates[0].id,value:a},{rule:candidates[j].id,value:b}]};
  }}
  return null;
}
/** Training-only construction. No holdout data is consulted before choosing the candidate. */
export function induceAndVerify(raw){
  const task=validateInduction(raw),cand=fixedCandidates(task.inputs),fit=affineFromTrain(task.inputs,task.train);
  if(fit)cand.push(fit);
  const qualified=cand.filter(c=>scoreCandidate(c,task.inputs,task.train).correct===task.train.length);
  const report={accepted:false,status:'no_match',reason:'訓練例に全件一致する規則がありません。',training:{correct:0,total:task.train.length},validation:{correct:0,total:task.holdout.length},candidates:qualified.length,chosen:null,ambiguity:null,graph:null,weights:0};
  if(!qualified.length){report.training.correct=Math.max(0,...cand.map(c=>scoreCandidate(c,task.inputs,task.train).correct));return report;}
  qualified.sort((a,b)=>a.complexity-b.complexity||a.id.localeCompare(b.id));
  const ambiguity=distinguish(qualified,task.inputs);
  if(ambiguity){report.status='ambiguous';report.reason='複数の規則が訓練例に一致しました。規則を区別できる追加の訓練例が必要です。';report.ambiguity=ambiguity;report.training.correct=task.train.length;return report;}
  const chosen=qualified[0],graph=graphFor(chosen,task.inputs),g=new WSPGraph(graph);
  const tested=g.evaluate(task.holdout.map(x=>({input:x.input,expected:[x.output]})));
  report.chosen=chosen.id;report.training.correct=task.train.length;
  report.validation.correct=tested.correct;
  report.graph=graph;report.weights=g.stats.weights;
  report.accepted=tested.correct===tested.total;
  report.status=report.accepted?'passed':'holdout_failed';
  report.reason=report.accepted?'訓練と未使用評価の全件に一致しました。':'未使用評価で誤りを検出したため、不採用です。';
  if(report.accepted)verified.set(report,{serial:JSON.stringify(report.graph),holdout:copy(task.holdout)});
  return report;
}
/** Reject fake/stale/modified reports. Atomic graph install retains WSPGraph rollback. */
export function promoteInduction(report,activeGraph){
  const token=verified.get(report);
  if(!token||report.accepted!==true||JSON.stringify(report.graph)!==token.serial||!(activeGraph instanceof WSPGraph))fail('検証済みの変更されていない回路だけ適用できます');
  const g=new WSPGraph(report.graph);
  const e=g.evaluate(token.holdout.map(r=>({input:r.input,expected:[r.output]})));
  if(e.correct!==e.total)fail('再検証に不合格です');
  const result=activeGraph.install(report.graph,true);verified.delete(report);
  return result;
}
export const INDUCTION_DEMO=Object.freeze({
  inputs:['x','y'],
  train:[{input:[-3,2],output:-4},{input:[1,4],output:12},{input:[5,-2],output:12},{input:[0,0],output:1},{input:[-1,-4],output:-10},{input:[3,3],output:16},{input:[9,1],output:30},{input:[2,-3],output:1}],
  holdout:[{input:[-5,4],output:-6},{input:[7,2],output:26},{input:[4,-3],output:7},{input:[0,5],output:11},{input:[6,0],output:19}]
});
