import test from 'node:test';
import assert from 'node:assert/strict';
import {WSPBulk} from '../chat_web/wsp_bulk.js';
import {WSPFlow} from '../chat_web/wsp_flow.js';
import {AUTO_DEMO,AUTO_FLOW_DEMO,designAndVerify,promoteVerified,synthesize,validateTask,evaluate,planFlow} from '../chat_web/wsp_autodesign.js';
const copy=x=>JSON.parse(JSON.stringify(x));
test('sample designs actual numerical ReLU WSP and independent holdout passes',()=>{
 const r=designAndVerify(AUTO_DEMO);
 assert.equal(r.accepted,true);assert.equal(r.stats.rules,3);assert.equal(r.stats.neurons,3);
 assert.equal(r.training.accuracy,1);assert.equal(r.validation.accuracy,1);
 assert.deepEqual(new Set(r.rules.flatMap(x=>x.all)),new Set(['おはよう','エラー','計算']));
});
test('explicit promotion changes circuit, rollback restores old rules',()=>{
 const bulk=new WSPBulk();bulk.replaceRules([{id:'existing',all:['keep'],response:'KEEP'}]);
 const before=bulk.snapshot();let report=designAndVerify(AUTO_DEMO);
 promoteVerified(report,bulk);assert.equal(bulk.infer('計算したい').match.response,'計算');
 assert.equal(bulk.restorePreviousRules(),true);assert.deepEqual(bulk.snapshot(),before);
});
test('independent holdout failure leads to rejection and leaves existing circuit untouched',()=>{
 const spec=copy(AUTO_DEMO);spec.validation[0].output='計算';
 const r=designAndVerify(spec);assert.equal(r.accepted,false);assert.ok(r.validation.errors.length);
 const bulk=new WSPBulk();bulk.replaceRules([{id:'safe',all:['safe'],response:'ok'}]);let old=bulk.snapshot();
 assert.throws(()=>promoteVerified(r,bulk),/合格/);assert.deepEqual(bulk.snapshot(),old);
});
test('negative holdout detects false positive and prevents promotion',()=>{
 const spec=copy(AUTO_DEMO);spec.validation[3]={input:'計算したくない',output:null};
 const r=designAndVerify(spec);assert.equal(r.accepted,false);assert.equal(r.validation.falsePositive,1);
});
test('train/holdout overlap rejected (including punctuation normalization)',()=>{
 const spec=copy(AUTO_DEMO);spec.validation[0]={input:'おはよう!!!',output:'あいさつ'};
 assert.throws(()=>designAndVerify(spec),/重複/);
});
test('contradictory train labels rejected',()=>{
 const spec=copy(AUTO_DEMO);spec.train[1].input=spec.train[0].input;spec.train[1].output='計算';
 assert.throws(()=>validateTask(spec),/矛盾/);
});
test('unknown output in validation rejected',()=>{
 const spec=copy(AUTO_DEMO);spec.validation[1].output='哲学';assert.throws(()=>validateTask(spec),/訓練していない/);
});
test('insufficient train support cannot create fabricated rule',()=>{
 const spec=copy(AUTO_DEMO);spec.train.splice(0,1);assert.throws(()=>designAndVerify(spec),/2件未満/);
});
test('invalid thresholds and huge inputs rejected before compilation',()=>{
 const spec=copy(AUTO_DEMO);spec.minAccuracy=.1;assert.throws(()=>designAndVerify(spec),/minAccuracy/);
 spec.minAccuracy=1;spec.train[0].input='a'.repeat(301);assert.throws(()=>designAndVerify(spec),/input|例/);
});
test('unlearnable labels do not pass holdout even if train partially memorized',()=>{
 const spec=copy(AUTO_DEMO);spec.train[0].input='abc';spec.train[1].input='xyz';
 const r=designAndVerify(spec);assert.equal(r.accepted,false);assert.ok(r.training.accuracy<1);
});
test('restored WSP weights act identically after export/import',()=>{
 const r=designAndVerify(AUTO_DEMO),a=new WSPBulk();promoteVerified(r,a);
 const b=new WSPBulk();assert.equal(b.restore(JSON.parse(JSON.stringify(a.snapshot()))),true);
 for(const e of AUTO_DEMO.validation)assert.equal(a.infer(e.input).match?.response,b.infer(e.input).match?.response);
});
test('workflow auto-generates numeric transition circuit and rewinds',()=>{
 const p=planFlow(AUTO_FLOW_DEMO);const flow=new WSPFlow();flow.compile(p);
 assert.equal(flow.stats().transitions,11);assert.equal(flow.step('開始').state,'分析');
 assert.equal(flow.step('成功').state,'設計');assert.equal(flow.step('失敗').state,'設計');
 assert.equal(flow.rewind(),true);assert.equal(flow.state,'設計');
 assert.equal(flow.step('成功').state,'検証');assert.equal(flow.step('成功').state,'完了');
});
test('workflow invalid names do not change existing circuit',()=>{
 const flow=new WSPFlow();flow.compile(planFlow(AUTO_FLOW_DEMO));const baseline=flow.snapshot();
 assert.throws(()=>planFlow({goal:'test',steps:[{name:'完了',action:'bad'}]}),/重複|完了/);
 assert.deepEqual(flow.snapshot(),baseline);
});
test('synthesis cannot use validation examples for feature discovery',()=>{
 const altered=copy(AUTO_DEMO);altered.validation[0].input='秘密の検証入力';
 const one=synthesize(AUTO_DEMO),two=synthesize(altered);
 assert.deepEqual(one.rules,two.rules);
});
test('baseline and generated compare on independent data',()=>{
 const base=new WSPBulk(),proposed=synthesize(AUTO_DEMO).circuit;
 const x=evaluate(base,AUTO_DEMO.validation),y=evaluate(proposed,AUTO_DEMO.validation);
 assert.equal(x.correct,1);assert.equal(y.correct,4);
});

test('forged or altered evaluation report cannot be promoted',()=>{
 const r=designAndVerify(AUTO_DEMO),bulk=new WSPBulk();
 assert.throws(()=>promoteVerified({...r},bulk),/合格済み/);
 r.rules[0].response='tampered';assert.throws(()=>promoteVerified(r,bulk),/合格済み/);
 assert.equal(bulk.stats().rules,0);
});
