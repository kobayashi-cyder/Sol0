/** WSP finite-state circuit. One ReLU neuron per (state,event) transition,
 * numeric weights (1,1) and bias (-1) programmed without gradient descent.
 * This is an event-driven planner only. It DOES NOT execute OS actions.
 */
export const FLOW_LIMIT = 4096;
const clean = s => typeof s === 'string' ? s.normalize('NFKC').trim() : '';
const valid = s => clean(s).length>0 && clean(s).length<=60 && /^[-_\p{L}\p{N} ]+$/u.test(clean(s));
function validate(spec){
  if(!spec || typeof spec!=='object'||Array.isArray(spec)) throw Error('状態機械はオブジェクトです。');
  if(!Array.isArray(spec.transitions)||spec.transitions.length>FLOW_LIMIT)throw Error('最大4096遷移です。');
  if(!valid(spec.initial))throw Error('初期状態名が不正です。');
  const initial=clean(spec.initial),transitions=[],pairs=new Set(),states=new Set([initial]),events=new Set();
  for(const t of spec.transitions){
    if(!t||!valid(t.from)||!valid(t.event)||!valid(t.to)||typeof t.action!=='string'||t.action.length>400)throw Error('遷移の形式が不正です。');
    const from=clean(t.from),event=clean(t.event),to=clean(t.to),action=t.action;
    const pair=JSON.stringify([from,event]);if(pairs.has(pair))throw Error('同じ状態とイベントの遷移は重複できません。');pairs.add(pair);
    states.add(from);states.add(to);events.add(event);transitions.push({from,event,to,action});
  }
  if(states.size>256)throw Error('状態数は最大256です。');
  return {initial,transitions,states:[...states],events:[...events]};
}
export const FLOW_DEMO = {initial:'待機',transitions:[
  {from:'待機',event:'開始',to:'計画',action:'目標と合格基準を設定する'},
  {from:'計画',event:'調査',to:'実行準備',action:'必要な情報を整理する'},
  {from:'実行準備',event:'実行',to:'検証',action:'手順に沿って実行した結果を記録する'},
  {from:'検証',event:'合格',to:'完了',action:'成果を保存し、変更履歴を残す'},
  {from:'検証',event:'再試行',to:'実行準備',action:'失敗原因を記録して修正する'},
  {from:'完了',event:'リセット',to:'待機',action:'次の作業を受け付ける'}
]};
export class WSPFlow {
  constructor(){this.compile({initial:'待機',transitions:[]});}
  compile(spec){
    const validated=validate(spec),cells=[];
    // Explicit sparse numeric weights: two edges per transition.
    for(const t of validated.transitions)cells.push({fromIndex:validated.states.indexOf(t.from),eventIndex:validated.events.indexOf(t.event),wState:1,wEvent:1,bias:-1,next:validated.states.indexOf(t.to),action:t.action});
    // Atomic assignment after all input passes validation.
    this.initial=validated.initial;this.state=this.initial;this.historyBase=this.initial;this.transitions=validated.transitions;
    this.states=validated.states;this.events=validated.events;this.cells=cells;this.history=[];
    return this.stats();
  }
  step(event){
    const e=clean(event);if(!e||e.length>60)return {matched:false,state:this.state,error:'イベントは1〜60文字です。'};
    const stateIdx=this.states.indexOf(this.state),eventIdx=this.events.indexOf(e);
    if(eventIdx<0)return {matched:false,state:this.state,error:'未登録のイベントです。'};
    const matches=[];
    for(let i=0;i<this.cells.length;i++){
      const c=this.cells[i],xState=Number(stateIdx===c.fromIndex),xEvent=Number(eventIdx===c.eventIndex);
      const activation=Math.max(0,c.wState*xState+c.wEvent*xEvent+c.bias);
      if(activation>0)matches.push({index:i,activation,cell:c});
    }
    if(matches.length!==1)return {matched:false,state:this.state,error:matches.length?'遷移が競合しています。':'現在の状態に該当する遷移はありません。'};
    const found=matches[0],before=this.state;
    this.state=this.states[found.cell.next];this.history.push({before,event:e,after:this.state,neuron:found.index});
    if(this.history.length>256)this.historyBase=this.history.shift().after;
    return {matched:true,before,event:e,state:this.state,action:found.cell.action,neuron:found.index,activation:found.activation};
  }
  rewind(){const last=this.history.at(-1);if(!last||this.state!==last.after)return false;
    this.state=last.before;this.history.pop();return true;}
  snapshot(){return {initial:this.initial,transitions:this.transitions.map(t=>({...t})),state:this.state,historyBase:this.historyBase,history:this.history.map(x=>({...x}))};}
  restore(data){try{
    const next=new WSPFlow();next.compile(data);
    if(!Array.isArray(data.history)||data.history.length>256)throw Error('履歴が不正です。');
    for(const item of data.history){
      // bounded replay from initial or from omitted prefix after 256 entries
      if(!item||typeof item.event!=='string'||typeof item.after!=='string'||typeof item.before!=='string')throw Error('履歴要素が不正です。');
    }
    // When history was truncated, replay only from the explicitly saved checkpoint.
    const checkpoint=data.historyBase??next.initial;
    if(!next.states.includes(checkpoint))throw Error('履歴のチェックポイントが不正です。');
    next.state=checkpoint;next.historyBase=checkpoint;
    let state=checkpoint;
    for(const item of data.history){
      if(item.before!==state)throw Error('履歴の起点が不正です。');
      const out=next.step(item.event);
      if(!out.matched||out.state!==item.after||out.neuron!==item.neuron)throw Error('履歴が回路と矛盾しています。');
      state=out.state;
    }
    if(state!==data.state)throw Error('保存状態と履歴が不一致です。');
    Object.assign(this,{initial:next.initial,state:next.state,transitions:next.transitions,states:next.states,events:next.events,cells:next.cells,history:next.history,historyBase:next.historyBase});return true;
  }catch{return false;}}
  stats(){return {states:this.states.length,events:this.events.length,transitions:this.cells.length,edges:this.cells.length*2,numericBytes:this.cells.length*13};}
}
