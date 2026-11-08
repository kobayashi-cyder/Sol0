import test from 'node:test';
import assert from 'node:assert/strict';
import {WSPBulk, WSP_DEMO_RULES, syntheticRules, WSP_MAX_RULES} from '../chat_web/wsp_bulk.js';
import {SolZeroEngine} from '../chat_web/engine.js';
function make(){const c=new WSPBulk();return c;}
test('directly compiled dense intents use numeric sparse weights and ReLU gates',()=>{
  const c=make();const out=c.replaceRules([{id:'ab',all:['alpha','beta'],response:'match'},
    {id:'a',all:['alpha'],response:'partial',priority:-1}]);
  assert.equal(out.rules,2);assert.equal(out.neurons,2);
  assert.equal(out.edges,3);assert.equal(c.biases[0],-1);
  assert.equal(c.infer('alpha beta').match.response,'match');
  assert.equal(c.infer('alpha').match.rule,'a');
  assert.equal(c.infer('beta').match,null);
  assert.ok(c.weights instanceof Int8Array);assert.ok(c.cols instanceof Uint32Array);
});
test('positive AND, negative exclusion, OR expansion, NFKC and exact clauses',()=>{
 const c=make();c.replaceRules([
  {id:'only',all:['条件Ａ'],not:['中止'],response:'allowed',priority:4},
  {id:'or',all:['画面'],any:['開く','閉じる'],response:'screen'},
  {id:'exact',all:['/reset'],exact:true,response:'reset',priority:9}
 ]);
 assert.equal(c.infer('条件A').match.rule,'only');
 assert.equal(c.infer('条件Ａ　中止').match,null);
 assert.equal(c.infer('画面を開く').match.rule,'or');
 assert.equal(c.infer('画面を閉じる').match.rule,'or');
 assert.equal(c.infer('画面を').match,null);
 assert.equal(c.infer('/reset').match.rule,'exact');
 assert.equal(c.infer('/reset immediately').match,null);
 assert.equal(c.stats().neurons,4);
});
test('priority tie is stable and trace includes real firing neuron',()=>{
 const c=make();c.replaceRules([{id:'low',all:['検査'],response:'low',priority:0},
 {id:'high',all:['検査'],response:'high',priority:5}]);
 const out=c.infer('検査',{trace:true});assert.equal(out.match.rule,'high');
 assert.deepEqual(out.fired.map(x=>x.rule),['high','low']);
 assert.equal(out.fired[0].activation,1);
});
test('numeric weight patch changes inference, rollback restores exactly',()=>{
 const c=make();c.replaceRules([{id:'gate',all:['ping'],response:'pong'}]);
 const v=c.infer('ping').match;assert.equal(v.response,'pong');
 assert.deepEqual([c.weights[0],c.biases[0]],[1,0]);
 c.editWeight(0,'ping',0);assert.equal(c.infer('ping').match,null);
 const snap=c.snapshot();const restored=make();assert.equal(restored.restore(snap),true);
 assert.equal(restored.infer('ping').match,null);
 assert.equal(restored.rollbackWeight(),true);assert.equal(restored.infer('ping').match.response,'pong');
 assert.equal(c.rollbackWeight(),true);assert.equal(c.rollbackWeight(),false);
});
test('atomic rejected replacement leaves all connections unchanged',()=>{
 const c=make();c.replaceRules(WSP_DEMO_RULES);const before=c.snapshot();
 for(const invalid of [
  [{id:'x',all:['foo'],response:'a'},{id:'x',all:['bar'],response:'b'}],
  [{id:'x',all:['foo'],not:['foo'],response:'a'}],
  [{id:'x',all:['foo'],priority:Infinity,response:'a'}],
  [{id:'x',all:[],response:'a'}],
  Array.from({length:WSP_MAX_RULES+1},(_,i)=>({id:'r'+i,all:['a'],response:'v'}))
 ]){
  assert.throws(()=>c.replaceRules(invalid));assert.deepEqual(c.snapshot(),before);
 }
 assert.ok(c.infer('計画と手順を作ろう').match);
});
test('restore rejects malformed or tampered patch without changing current circuit',()=>{
 const c=make();c.replaceRules([{id:'alpha',all:['a'],response:'1'}]);
 const snap=c.snapshot();
 assert.equal(c.restore({rules:[{id:'bad',all:[],response:'x'}],patches:[]}),false);
 assert.deepEqual(c.snapshot(),snap);
 assert.equal(c.restore({rules:snap.rules,patches:[{neuron:0,feature:'a',before:999,after:0}]}),false);
 assert.deepEqual(c.snapshot(),snap);
});
test('single previous batch may be restored without losing prior patches',()=>{
 const c=make();c.replaceRules([{id:'a',all:['word'],response:'ok'}]);
 c.editWeight(0,'word',0);assert.equal(c.infer('word').match,null);
 c.replaceRules([{id:'b',all:['other'],response:'new'}]);
 assert.equal(c.infer('other').match.response,'new');
 assert.equal(c.restorePreviousRules(),true);
 assert.equal(c.infer('word').match,null);
 assert.equal(c.rollbackWeight(),true);assert.equal(c.infer('word').match.response,'ok');
 assert.equal(c.restorePreviousRules(),false);
});
test('chat returns WSP answer only with matching compiled rule and supports commands',()=>{
 const c=make();const engine=new SolZeroEngine();engine.bulk=c;
 assert.match(engine.reply('/wsp add 状態 & !停止 => 動作中'),/コンパイル完了/);
 assert.match(engine.reply('状態を確認'),/動作中/);
 assert.doesNotMatch(engine.reply('状態停止'),/動作中/);
 assert.match(engine.reply('/wsp trace 状態'),/ニューロン/);
 assert.match(engine.reply('/wsp list'),/状態/);
 assert.match(engine.reply('/wsp'),/1ルール/);
 assert.match(engine.reply('/wsp undo'),/取り消しました/);
 assert.doesNotMatch(engine.reply('状態を確認'),/動作中/);
});
test('4096 generated separate rules compile, infer and occupy <5MB of JSON',()=>{
 const c=make(),r=syntheticRules(4096),st=c.replaceRules(r);
 assert.equal(st.rules,4096);assert.equal(st.neurons,4096);assert.equal(st.edges,4096);
 assert.equal(st.features,4096);assert.ok(st.serializedBytes<1_000_000);
 for(const i of [0,1,17,511,1024,2048,4095]){
   const out=c.infer(`実験 検証キー${String(i).padStart(4,'0')} 開始`).match;
   assert.equal(out?.response,`検証値${i}`);
 }
 assert.equal(c.infer('no match').match,null);
});
