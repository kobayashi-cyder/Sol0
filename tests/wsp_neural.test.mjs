import test from 'node:test';
import assert from 'node:assert/strict';
import {NEURAL_DEMO,NEURAL_LIMITS,WeightSpaceNetwork,trainAndVerifyNeural,promoteNeural,validateNeuralTask} from '../chat_web/wsp_neural.js';
const clone=v=>JSON.parse(JSON.stringify(v));
test('from-scratch WSP learns unseen quadratic samples from learned weights',()=>{
 const task=clone(NEURAL_DEMO),r=trainAndVerifyNeural(task);
 assert.equal(r.status,'passed');assert.equal(r.training.correct,task.train.length);
 assert.equal(r.validation.correct,task.holdout.length);assert.equal(r.accepted,true);
 assert.ok(r.parameters>=37);assert.ok(r.validation.maxError<task.tolerance);
 const net=new WeightSpaceNetwork();assert.equal(promoteNeural(r,net),r.parameters);
 assert.ok(Math.abs(net.run([1.3])[0]-1.69)<.25);
});
test('XOR behavior arises from trained dense weights, not a special XOR branch',()=>{
 const sample=[];for(let a=0;a<=1;a++)for(let b=0;b<=1;b++)for(const j of [-.1,0,.1])
  sample.push({input:[a+j,b+j],output:[a^b]});
 const task={inputs:2,outputs:1,hidden:12,seed:58,epochs:1600,tolerance:.24,train:sample,
  holdout:[[0,.16],[.17,1],[1,.17],[.84,.84]].map(([x,y])=>({input:[x,y],output:[Math.round(x)^Math.round(y)]}))};
 const report=trainAndVerifyNeural(task);assert.equal(report.accepted,true);
 assert.equal(report.validation.correct,4);
 const net=new WeightSpaceNetwork();promoteNeural(report,net);
 assert.equal(Math.round(net.run([0,1])[0]),1);
 assert.ok(Math.abs(net.run([1,1])[0])<.24);
});
test('heldout labels never affect trained weights, but can veto promotion',()=>{
 const altered=clone(NEURAL_DEMO);altered.holdout[0].output=[9999];
 const a=trainAndVerifyNeural(NEURAL_DEMO),b=trainAndVerifyNeural(altered);
 assert.deepEqual(a.model,b.model);assert.equal(a.accepted,true);assert.equal(b.accepted,false);
 const net=new WeightSpaceNetwork(),before=net.snapshot();
 assert.throws(()=>promoteNeural(b,net),/未検証/);assert.deepEqual(net.snapshot(),before);
});
test('export/import, rollback, tampering and repeated promotion are checked',()=>{
 const r=trainAndVerifyNeural(NEURAL_DEMO),net=new WeightSpaceNetwork();
 const first=promoteNeural(r,net);assert.ok(first>0);
 const snapshot=net.snapshot(),other=new WeightSpaceNetwork();
 assert.equal(other.restore(JSON.parse(JSON.stringify(snapshot))),true);
 for(const x of [[-1.1],[.2],[1.8]])assert.deepEqual(other.run(x),net.run(x));
 assert.throws(()=>promoteNeural(r,net),/未検証/);
 const modified=clone(snapshot);modified.w1[0]=Infinity;
 assert.equal(other.restore(modified),false);assert.deepEqual(other.run([.2]),net.run([.2]));
 const newer=trainAndVerifyNeural({...clone(NEURAL_DEMO),seed:888});assert.equal(newer.accepted,true);
 promoteNeural(newer,net);assert.equal(net.rollback(),true);
 assert.deepEqual(net.snapshot(),snapshot);assert.equal(net.rollback(),false);
 const tampered=trainAndVerifyNeural(NEURAL_DEMO);tampered.model.w1[0]++;
 assert.throws(()=>promoteNeural(tampered,net),/改ざん/);
});
test('shape, duplicate, nonfinite, compute-cap and untrained inference are rejected',()=>{
 const edit=patch=>({...clone(NEURAL_DEMO),...patch});
 assert.throws(()=>validateNeuralTask(edit({hidden:999})),/不正/);
 assert.throws(()=>validateNeuralTask(edit({epochs:1700})),/不正/);
 assert.throws(()=>validateNeuralTask(edit({train:[...NEURAL_DEMO.train,NEURAL_DEMO.train[0]]})),/重複/);
 assert.throws(()=>validateNeuralTask(edit({holdout:[...NEURAL_DEMO.holdout,{input:[-2],output:[4]}]})),/重複/);
 assert.throws(()=>trainAndVerifyNeural(edit({train:[...NEURAL_DEMO.train.slice(0,8),{input:[2],output:[NaN]}]})),/有限数値/);
 assert.throws(()=>trainAndVerifyNeural(edit({train:[...NEURAL_DEMO.train.slice(0,8),{input:[2],output:[Infinity]}]})),/有限数値/);
 assert.throws(()=>trainAndVerifyNeural(edit({inputs:8,outputs:4,hidden:24,epochs:1600,
  train:Array.from({length:64},(_,i)=>({input:[i,0,0,0,0,0,0,0],output:[0,0,0,0]})),
  holdout:Array.from({length:3},(_,i)=>({input:[i+65,0,0,0,0,0,0,0],output:[0,0,0,0]}))})),/演算上限/);
 const n=new WeightSpaceNetwork();assert.throws(()=>n.run([2]),/学習済み/);
 assert.equal(NEURAL_LIMITS.hidden,24);
});
test('training is reproducible with fixed seed independent of external data',()=>{
 const a=trainAndVerifyNeural(NEURAL_DEMO),b=trainAndVerifyNeural(NEURAL_DEMO);
 assert.deepEqual(a.model,b.model);assert.deepEqual(a.validation,b.validation);
});
