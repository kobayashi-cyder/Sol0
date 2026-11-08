/** BANC888 bounded cognition core, imported without remote model dependencies.
 * Source: repository branch banc888-selfhealing-ui-v1, app/src/main/assets/cognition-core.js.
 * This is an optional symbolic *verification/planning* utility; the numerical
 * WSP neural network remains the independent learned-weight engine.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.FFCCognitionCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

// Bounded, offline symbolic cognition. This is a verified-action planner, not
// a language model or an assertion of AGI. Every world-state update in execute
// mode requires an explicitly returned observation.
const VERSION='1.0';
const LIMIT={bytes:64000,facts:64,actions:96,rules:48,states:1800,depth:16,steps:16,observations:64};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const scalar=x=>x===null||typeof x==='string'&&x.length<=240||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x);
const same=(a,b)=>a===b;
const plain=x=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.prototype.toString.call(x)!=='[object Object]')return false;const p=Object.getPrototypeOf(x);return p===null||p===Object.prototype||Object.getPrototypeOf(p)===null;};
function fail(code,detail){const e=new Error(detail||code);e.code=code;throw e}
function keyOk(k){return typeof k==='string'&&k.length>0&&k.length<=96&&!/[\u0000-\u001f]/.test(k)&&!['__proto__','prototype','constructor'].includes(k)}
function facts(value,label,{empty=true}={}){
 if(!plain(value))fail('invalid_facts',label+' must be an object');
 const entries=Object.entries(value);
 if(entries.length>LIMIT.facts||(!empty&&!entries.length))fail('invalid_facts',label+' fact count');
 const result=Object.create(null);
 for(const [k,v] of entries){if(!keyOk(k)||!scalar(v))fail('invalid_facts',label+' key/value is not a bounded scalar');result[k]=v}
 return result;
}
function safeArgs(value){
 if(!plain(value))fail('invalid_args','tool arguments must be a JSON object');
 let json;
 try{json=JSON.stringify(value)}catch{fail('invalid_args','tool arguments must be JSON serializable')}
 if(!json||json.length>12000)fail('invalid_args','tool arguments exceed 12000 characters');
 // Reject ambient executable data and prototype pollution at every nesting level.
 const seen=new WeakSet();
 function inspect(x,depth){
  if(depth>12)fail('invalid_args','tool arguments are too deep');
  if(!x||typeof x!=='object')return;
  if(seen.has(x))fail('invalid_args','cyclic tool arguments');
  seen.add(x);
  for(const [k,v] of Object.entries(x)){
   if(!keyOk(k)||typeof v==='function'||typeof v==='symbol'||typeof v==='undefined')fail('invalid_args','invalid argument key/value');
   if(v&&typeof v==='object')inspect(v,depth+1);
  }
 }
 inspect(value,0);
 return JSON.parse(json);
}
function normalize(input){
 if(!plain(input)||input.schema!==1)fail('invalid_task','task must have schema 1');
 let bytes;
 try{bytes=JSON.stringify(input)?.length}catch{fail('invalid_task','task is not serializable')}
 if(!bytes||bytes>LIMIT.bytes)fail('invalid_task','task exceeds size limit');
 const initial=facts(input.facts,'facts'),goal=facts(input.goal,'goal',{empty:false});
 if(!Array.isArray(input.actions)||input.actions.length>LIMIT.actions)fail('invalid_actions','actions must be a bounded array');
 if(input.rules!==undefined&&(!Array.isArray(input.rules)||input.rules.length>LIMIT.rules))fail('invalid_rules','rules must be a bounded array');
 const ids=new Set();
 const actions=input.actions.map((raw,i)=>{
  if(!plain(raw)||!keyOk(raw.id)||ids.has(raw.id))fail('invalid_actions','unique action ID required');
  if(typeof raw.tool!=='string'||!/^[a-z][a-z0-9_.-]{0,127}$/.test(raw.tool))fail('invalid_actions','registered tool name required');
  const requires=facts(raw.requires||{},'requires'),effects=facts(raw.effects,'effects',{empty:false});
  if(raw.cost!==undefined&&(!Number.isFinite(raw.cost)||raw.cost<.01||raw.cost>100))fail('invalid_actions','invalid action cost');
  ids.add(raw.id);
  return{id:raw.id,tool:raw.tool,requires,effects,args:safeArgs(raw.args||{}),cost:raw.cost??1,ordinal:i};
 });
 const rules=(input.rules||[]).map((raw,i)=>{
  if(!plain(raw))fail('invalid_rules','rule must be an object');
  const cond=facts(raw.if,'rule antecedent',{empty:false}),then=facts(raw.then,'rule consequent',{empty:false});
  return{id:keyOk(raw.id)?raw.id:'rule-'+i,if:cond,then};
 });
 if(input.maxStates!==undefined&&(!Number.isInteger(input.maxStates)||input.maxStates<1||input.maxStates>LIMIT.states))fail('invalid_task','invalid maxStates');
 if(input.maxDepth!==undefined&&(!Number.isInteger(input.maxDepth)||input.maxDepth<1||input.maxDepth>LIMIT.depth))fail('invalid_task','invalid maxDepth');
 return{schema:1,facts:initial,goal,actions,rules,maxStates:input.maxStates??800,maxDepth:input.maxDepth??10};
}
function matches(current,required){for(const [k,v] of Object.entries(required))if(!own(current,k)||!same(current[k],v))return false;return true}
function serial(state){return JSON.stringify(Object.entries(state).sort(([a],[b])=>a.localeCompare(b)))}
function closure(base,rules){
 const state={...base},proofs=[];
 for(let round=0;round<=rules.length;round++){
  let changed=false;
  for(const rule of rules){
   if(!matches(state,rule.if))continue;
   for(const [k,v] of Object.entries(rule.then)){
    if(own(state,k)){if(!same(state[k],v))return{ok:false,error:'conflicting inference for '+k,proofs};continue}
    state[k]=v;proofs.push({rule:rule.id,fact:k,value:v});changed=true;
   }
  }
  if(!changed)return{ok:true,state,proofs};
 }
 return{ok:false,error:'inference did not converge',proofs};
}
function infer(task){const n=normalize(task),c=closure(n.facts,n.rules);return c.ok?{status:'inferred',facts:c.state,proofs:c.proofs,goalSatisfied:matches(c.state,n.goal)}:{status:'blocked',reason:c.error,proofs:c.proofs}}
class MinHeap{
 constructor(){this.items=[]}
 push(x){const a=this.items;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(!less(x,a[p]))break;a[i]=a[p];i=p}a[i]=x}
 pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&less(a[j+1],a[j]))j++;if(!less(a[j],last))break;a[i]=a[j];i=j}a[i]=last}return first}
 get size(){return this.items.length}
}
function less(a,b){return a.cost<b.cost||(a.cost===b.cost&&(a.depth<b.depth||(a.depth===b.depth&&a.order<b.order)))}
function reliabilityPenalty(action,stats={}){
 const s=stats[action.tool+'|'+action.id];if(!s)return 0;
 const attempts=Math.min(1000,Math.max(0,Number(s.attempts)||0)),success=Math.min(attempts,Math.max(0,Number(s.success)||0));
 return Math.min(4,(attempts-success+1)/(attempts+2)*2);
}
function plan(input,opts={}){
 const t=normalize(input),start=closure(t.facts,t.rules);
 if(!start.ok)return{status:'blocked',reason:'inference_conflict',detail:start.error,expanded:0};
 if(matches(start.state,t.goal))return{status:'satisfied_assumed',steps:[],expanded:0,proofs:start.proofs,scope:'provided or logically inferred facts, not independently observed'};
 const stats=plain(opts.stats)?opts.stats:{},excluded=new Set(opts.exclude||[]),best=new Map(),queue=new MinHeap();
 const stateKey=serial(t.facts);best.set(stateKey,0);let order=0,expanded=0,conflicts=0;
 queue.push({base:t.facts,cost:0,depth:0,path:[],order:order++});
 while(queue.size&&expanded<t.maxStates){
  const head=queue.pop(),identity=serial(head.base);
  if(head.cost>(best.get(identity)??Infinity)+1e-9)continue;
  expanded++;
  const resolved=closure(head.base,t.rules);
  if(!resolved.ok){conflicts++;continue}
  if(matches(resolved.state,t.goal))return{status:'planned',steps:head.path,cost:head.cost,expanded,proofs:resolved.proofs,scope:'symbolic plan; predicted effects not execution evidence'};
  if(head.depth>=t.maxDepth)continue;
  for(const action of t.actions){
   if(excluded.has(action.id)||!matches(resolved.state,action.requires))continue;
   const next={...head.base,...action.effects},key=serial(next);
   if(key===identity)continue;
   const c=closure(next,t.rules);if(!c.ok){conflicts++;continue}
   const cost=head.cost+action.cost+reliabilityPenalty(action,stats);
   if(cost>=(best.get(key)??Infinity)-1e-9)continue;
   best.set(key,cost);
   queue.push({base:next,cost,depth:head.depth+1,path:[...head.path,{id:action.id,tool:action.tool,cost:action.cost}],order:order++});
  }
 }
 return{status:'blocked',reason:queue.size?'search_budget_exhausted':'no_valid_plan',expanded,conflicts,maxStates:t.maxStates};
}
// Adapt policy only on actually observed outcomes, never on speculation.
function record(stats,action,success){
 const key=action.tool+'|'+action.id,old=stats[key]||{attempts:0,success:0};
 stats[key]={attempts:Math.min(1000,(+old.attempts||0)+1),success:Math.min(1000,(+old.success||0)+(success?1:0))};
 return stats[key];
}
async function solve(input,adapter={},opts={}){
 const task=normalize(input),stats={...(plain(opts.stats)?opts.stats:{})};
 const execute=opts.execute===true;
 if(!execute)return{...plan(input,{stats}),executed:false,trace:[],stats};
 const maxSteps=Number.isInteger(opts.maxSteps)?Math.min(LIMIT.steps,Math.max(1,opts.maxSteps)):12;
 const excluded=new Set(),trace=[];let base={...task.facts},failures=0;
 if(typeof adapter.authorize!=='function'||typeof adapter.select!=='function'||typeof adapter.invoke!=='function')return{status:'blocked',reason:'missing_execution_adapters',executed:false,trace,stats};
 for(let turn=0;turn<maxSteps;turn++){
  const current={...input,facts:base};
  const candidate=plan(current,{stats,exclude:excluded});
  if(candidate.status==='satisfied_assumed')return{status:trace.length?'done':'satisfied_assumed',executed:!!trace.length,trace,facts:base,stats,verification:trace.length?'tool_reported_observations':'initial_facts_only'};
  if(candidate.status!=='planned')return{status:'blocked',reason:candidate.reason,detail:candidate.detail,executed:trace.length>0,trace,facts:base,stats};
  const next=task.actions.find(a=>a.id===candidate.steps[0].id);
  if(!next)return{status:'blocked',reason:'planner_invalid_action',trace,stats};
  const permission=await adapter.authorize(next);
  if(permission!==true)return{status:'blocked',reason:'permission_denied',action:next.id,executed:trace.length>0,trace,facts:base,stats};
  const activation=await adapter.select(next);
  if(!activation||activation.tool!==next.tool)return{status:'blocked',reason:'no_connectome_output',action:next.id,executed:trace.length>0,trace,facts:base,stats};
  let result;
  try{result=await adapter.invoke(next)}catch(e){result={ok:false,error:String(e&&e.message||e)}}
  if(!result||!result.ok){
   record(stats,next,false);excluded.add(next.id);failures++;
   trace.push({action:next.id,tool:next.tool,ok:false,reason:String(result?.error||'tool_failed').slice(0,320),activation:activation.connectome?.route||null});
   if(adapter.onOutcome)await adapter.onOutcome(next,false,result);
   continue;
  }
  const reported=result.observedFacts??result.value?.observedFacts;
  if(!plain(reported)||!Object.keys(reported).length){
   trace.push({action:next.id,tool:next.tool,ok:false,reason:'missing_observation',activation:activation.connectome?.route||null});
   if(adapter.onOutcome)await adapter.onOutcome(next,null,result);
   return{status:'blocked',reason:'missing_observation',executed:true,trace,facts:base,stats};
  }
  let observation;
  try{observation=facts(reported,'observedFacts',{empty:false})}catch(e){
   if(adapter.onOutcome)await adapter.onOutcome(next,null,result);
   return{status:'blocked',reason:'invalid_observation',detail:String(e.message||e),executed:true,trace,facts:base,stats};
  }
  const proven=Object.entries(next.effects).every(([k,v])=>own(observation,k)&&same(observation[k],v));
  const revised={...base,...observation},inferred=closure(revised,task.rules);
  if(!inferred.ok){
   if(adapter.onOutcome)await adapter.onOutcome(next,null,result);
   return{status:'blocked',reason:'observation_conflict',detail:inferred.error,executed:true,trace,facts:base,stats};
  }
  base=revised;record(stats,next,proven);if(!proven){excluded.add(next.id);failures++}
  trace.push({action:next.id,tool:next.tool,ok:proven,reason:proven?'effects_observed':'effects_not_observed',observed:Object.keys(observation),activation:activation.connectome?.route||null});
  if(adapter.onOutcome)await adapter.onOutcome(next,proven,result);
  if(matches(inferred.state,task.goal))return{status:'done',executed:true,trace,facts:base,derived:inferred.proofs,stats,verification:'tool_reported_observations'};
 }
 return{status:'blocked',reason:'step_budget_exhausted',executed:trace.length>0,trace,facts:base,stats,failures};
}
return{VERSION,LIMIT,normalize,closure,infer,plan,solve,record};
});

export const BANC_COGNITION=globalThis.FFCCognitionCore;
