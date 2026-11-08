import test from 'node:test';
import assert from 'node:assert/strict';
import {WSPFlow,FLOW_DEMO,FLOW_LIMIT} from '../chat_web/wsp_flow.js';
import {SolZeroEngine} from '../chat_web/engine.js';
test('scratch state-event neurons are direct numeric 1+1-1 ReLU gates',()=>{
 const f=new WSPFlow(),s=f.compile(FLOW_DEMO);
 assert.equal(s.transitions,6);assert.equal(s.edges,12);
 assert.equal(f.cells[0].bias,-1);assert.equal(f.cells[0].wState,1);assert.equal(f.cells[0].wEvent,1);
 const a=f.step('開始');assert.equal(a.state,'計画');assert.equal(a.activation,1);
 assert.equal(f.step('開始').matched,false);
 assert.equal(f.step('調査').state,'実行準備');
 assert.equal(f.step('実行').state,'検証');assert.equal(f.step('再試行').state,'実行準備');
 assert.equal(f.rewind(),true);assert.equal(f.state,'検証');
});
test('compile validates duplicate event-state pair atomically',()=>{
 const f=new WSPFlow();f.compile(FLOW_DEMO);const snap=f.snapshot();
 assert.throws(()=>f.compile({initial:'待機',transitions:[FLOW_DEMO.transitions[0],FLOW_DEMO.transitions[0]]}));
 assert.deepEqual(f.snapshot(),snap);
 assert.throws(()=>f.compile({initial:'待機',transitions:Array.from({length:FLOW_LIMIT+1},()=>FLOW_DEMO.transitions[0])}));
 assert.deepEqual(f.snapshot(),snap);
});
test('flow state and audit history survive save/restore and reject tampering',()=>{
 const f=new WSPFlow();f.compile(FLOW_DEMO);f.step('開始');f.step('調査');
 const snap=f.snapshot(),other=new WSPFlow();assert.equal(other.restore(snap),true);
 assert.equal(other.state,'実行準備');assert.equal(other.rewind(),true);assert.equal(other.state,'計画');
 const malicious={...snap,history:[...snap.history.map(x=>({...x}))]};malicious.history[0].after='別状態';
 const copy=other.snapshot();assert.equal(other.restore(malicious),false);assert.deepEqual(other.snapshot(),copy);
});
test('flow audit window 256 events remains restorable',()=>{
 const f=new WSPFlow();f.compile({initial:'A',transitions:[
   {from:'A',event:'go',to:'B',action:'step'},
   {from:'B',event:'go',to:'A',action:'step'}
 ]});
 for(let i=0;i<280;i++)assert.equal(f.step('go').matched,true);
 assert.equal(f.history.length,256);
 assert.equal(f.historyBase,'A');
 const other=new WSPFlow();assert.equal(other.restore(f.snapshot()),true);
 assert.equal(other.state,f.state);
});
test('engine integrates flow chat commands but performs no external action',()=>{
 const e=new SolZeroEngine();e.flow=new WSPFlow();e.flow.compile(FLOW_DEMO);
 assert.match(e.reply('/flow'),/現在「待機」/);
 assert.match(e.reply('/flow event 開始'),/待機 → 計画/);
 assert.match(e.reply('/flow event 調査'),/実行準備/);
 assert.match(e.reply('/flow back'),/戻しました/);
 assert.equal(e.flow.state,'計画');
});
test('restored checkpoint remains valid after a subsequent snapshot',()=>{
 const f=new WSPFlow();f.compile({initial:'A',transitions:[
 {from:'A',event:'next',to:'B',action:'a'},{from:'B',event:'next',to:'A',action:'b'}]});
 for(let i=0;i<261;i++)f.step('next');
 const g=new WSPFlow();assert.equal(g.restore(f.snapshot()),true);
 const h=new WSPFlow();assert.equal(h.restore(g.snapshot()),true);
 assert.equal(g.historyBase,h.historyBase);
});
