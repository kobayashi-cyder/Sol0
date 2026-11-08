import test from 'node:test';
import assert from 'node:assert/strict';
import {WSPGraph,GRAPH_DEMO_XOR} from '../chat_web/wsp_graph.js';
import {INDUCTION_DEMO,INDUCTION_LIMITS,validateInduction,induceAndVerify,promoteInduction} from '../chat_web/wsp_induction.js';
const clone=x=>JSON.parse(JSON.stringify(x));

test('from-scratch affine synthesis learns numeric coefficients on unseen combinations',()=>{
  const r=induceAndVerify(INDUCTION_DEMO);
  assert.equal(r.status,'passed');assert.equal(r.accepted,true);
  assert.equal(r.chosen,'fitted_affine');assert.equal(r.validation.correct,5);
  const g=new WSPGraph(r.graph);
  for(const [x,y] of [[10,7],[-8,3],[23,-14]])assert.ok(Math.abs(g.run([x,y]).outputs.out[0]-(3*x+2*y+1))<1e-6);
  assert.deepEqual(r.graph.nodes[0].weights,[[3,2]]);
  assert.deepEqual(r.graph.nodes[0].bias,[1]);
});
test('promotion is separate from verified design; rollback restores previous graph',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR),before=g.snapshot(),r=induceAndVerify(INDUCTION_DEMO);
  const st=promoteInduction(r,g);
  assert.equal(st.weights,3);
  assert.equal(g.run([2,3]).outputs.out[0],13);
  assert.equal(g.rollback(),true);assert.deepEqual(g.snapshot(),before);
  assert.throws(()=>promoteInduction(r,g),/検証済み/);
});
test('holdout labels are never used to select candidate, only veto',()=>{
  const spec=clone(INDUCTION_DEMO);spec.holdout[2].output=999;
  const bad=induceAndVerify(spec),good=induceAndVerify(INDUCTION_DEMO);
  assert.equal(bad.chosen,good.chosen);
  assert.deepEqual(bad.graph,good.graph);
  assert.equal(bad.status,'holdout_failed');assert.equal(bad.validation.correct,4);
  const g=new WSPGraph(GRAPH_DEMO_XOR),before=g.snapshot();
  assert.throws(()=>promoteInduction(bad,g));assert.deepEqual(g.snapshot(),before);
});
test('duplicate inputs in train and across holdout are forbidden',()=>{
  const spec=clone(INDUCTION_DEMO);spec.holdout[0].input=spec.train[0].input;
  assert.throws(()=>validateInduction(spec),/重複/);
  const spec2=clone(INDUCTION_DEMO);spec2.train[1].input=spec2.train[0].input;
  assert.throws(()=>validateInduction(spec2),/重複/);
});
test('ambiguous induction abstains and supplies discriminating example',()=>{
  const train=[0,1,2,3,4,5].map(x=>({input:[x,x-10],output:x}));
  const holdout=[6,7,8,9].map(x=>({input:[x,x-10],output:x}));
  const r=induceAndVerify({inputs:['x','y'],train,holdout});
  assert.equal(r.status,'ambiguous');assert.equal(r.accepted,false);
  assert.ok(r.ambiguity?.input);
});
test('unsatisfiable train labels never produce accepted graph',()=>{
  const train=Array.from({length:8},(_,i)=>({input:[i,2*i+1],output:(i*i*i)%7}));
  const holdout=Array.from({length:4},(_,i)=>({input:[i+8,2*i+17],output:999}));
  const r=induceAndVerify({inputs:['x','y'],train,holdout});
  assert.equal(r.status,'no_match');assert.equal(r.graph,null);
});
test('nonlinear arithmetic supports abs, square and product when sufficiently sampled',()=>{
  for(const [kind,fn] of [['absdiff',(x,y)=>Math.abs(x-y)],['mul',(x,y)=>x*y],['relu',(x,y)=>Math.max(0,x-y)]]){
    const train=[[-4,2],[5,-3],[0,1],[-1,-5],[2,4],[3,3],[8,0],[-2,2]].map(input=>({input,output:fn(...input)}));
    const holdout=[[-5,1],[7,-2],[3,0],[-4,9]].map(input=>({input,output:fn(...input)}));
    const r=induceAndVerify({inputs:['x','y'],train,holdout});
    assert.equal(r.status,'passed',kind+' '+r.status+' '+r.reason);
    const g=new WSPGraph(r.graph);
    assert.equal(g.evaluate(holdout.map(v=>({input:v.input,expected:[v.output]}))).correct,4);
  }
});
test('forged, mutated or reused verified report cannot be installed',()=>{
  const graph=new WSPGraph(GRAPH_DEMO_XOR),old=graph.snapshot();
  const report=induceAndVerify(INDUCTION_DEMO);
  assert.throws(()=>promoteInduction({...report},graph));
  report.graph.nodes[0].bias[0]=777;
  assert.throws(()=>promoteInduction(report,graph));
  assert.deepEqual(graph.snapshot(),old);
});
test('input limits and injection attempts are refused before allocation',()=>{
  const spec=clone(INDUCTION_DEMO);
  spec.inputs=['__proto__','y'];assert.throws(()=>induceAndVerify(spec));
  spec.inputs=['x','y'];spec.train[0].output=Infinity;assert.throws(()=>induceAndVerify(spec));
  spec.train[0].output=-4;spec.train=Array.from({length:INDUCTION_LIMITS.trainMax+1},()=>spec.train[0]);assert.throws(()=>induceAndVerify(spec));
});
test('deterministic output and bounded WSP graph on same data',()=>{
  const a=induceAndVerify(INDUCTION_DEMO),b=induceAndVerify(INDUCTION_DEMO);
  assert.deepEqual(a.graph,b.graph);assert.ok(a.weights<20);
});
