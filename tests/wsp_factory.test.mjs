import test from 'node:test';
import assert from 'node:assert/strict';
import {FACTORY_FAMILIES,buildFactory,verifyFactory,auditFactory,composeFactories,referenceValue,FACTORY_LIMITS} from '../chat_web/wsp_factory.js';
import {WSPGraph,inspectGraph} from '../chat_web/wsp_graph.js';

test('30 distinct parameterized families and 65536 Boolean4 indexes',()=>{
  assert.equal(FACTORY_FAMILIES.length,30);
  assert.equal(new Set(FACTORY_FAMILIES.map(f=>f.id)).size,30);
  assert.equal(FACTORY_FAMILIES.find(f=>f.id==='lut4').variants,65536);
  assert.equal(FACTORY_LIMITS.distinctBoolean4,65536);
});
test('30 family implementations match independent math references across variants',()=>{
  for(const family of FACTORY_FAMILIES)for(const variant of [0,1,7,15,63,127,255,1023,4095,16383,65535]){
    if(variant>=family.variants)continue;
    const recipe=buildFactory(family.id,variant);
    assert.equal(verifyFactory(recipe).correct,recipe.cases.length,`${family.id}:${variant}`);
    assert.ok(recipe.stats.weights<=1000000);
  }
});
test('Boolean4 truth table implements all 16 cases for any indexed function',()=>{
  const recipe=buildFactory('lut4',43690),g=new WSPGraph(recipe.graph);
  for(const [i,c] of recipe.cases.entries())assert.deepEqual(g.run(c.input).outputs.output,[43690>>i&1]);
  assert.equal(verifyFactory(recipe).correct,16);
});
test('Boolean4 unique circuits, including all-zero and all-one',()=>{
  const a=buildFactory('lut4',0),b=buildFactory('lut4',65535);
  assert.equal(verifyFactory(a).correct,16);assert.equal(verifyFactory(b).correct,16);
  assert.equal(new WSPGraph(a.graph).run([1,0,1,1]).outputs.output[0],0);
  assert.equal(new WSPGraph(b.graph).run([1,0,1,1]).outputs.output[0],1);
});
test('mass synthesis materializes each circuit and compares with oracle',()=>{
  const report=auditFactory('lut4',12345,512);
  assert.equal(report.count,512);assert.equal(report.passed,512);
  assert.equal(report.verifiedCases,8192);
  assert.equal(report.materialized,false);
});
test('reject variant overflow, unknown families, excessive batch counts',()=>{
  assert.throws(()=>buildFactory('lut4',65536));
  assert.throws(()=>buildFactory('__proto__',0));
  assert.throws(()=>buildFactory('affine1',-1));
  assert.throws(()=>buildFactory('affine1',1.5));
  assert.throws(()=>auditFactory('lut4',0,513));
  assert.throws(()=>auditFactory('lut4',65500,512));
});
test('original graph and automatic factory graph can be composed serially',()=>{
  const composed=composeFactories([{family:'affine1',variant:6},{family:'relu_shift1',variant:21},{family:'sigmoid1',variant:200}]);
  assert.equal(composed.verified,true);
  assert.equal(composed.stages.length,3);
  assert.equal(new WSPGraph(composed.graph).evaluate(composed.cases).correct,composed.cases.length);
});
test('vector-output factory can feed scalar-output factory through pick',()=>{
  const composed=composeFactories([{family:'softmax3',variant:77},{family:'mean3',variant:9}]);
  assert.equal(composed.verified,true);
  const v=new WSPGraph(composed.graph).run([1,2,3]);
  assert.equal(Object.values(v.outputs)[0].length,1);
  assert.equal(composed.graph.nodes.filter(n=>n.op==='pick').length,3);
});
test('reject mismatched shapes and over-depth pipelines',()=>{
  assert.throws(()=>composeFactories([{family:'affine1',variant:0},{family:'xor2',variant:0}]),/不一致/);
  assert.throws(()=>composeFactories(Array(9).fill({family:'affine1',variant:0})),/2〜8/);
  assert.throws(()=>composeFactories([{family:'affine1',variant:0}]),/2〜8/);
});
test('factory output stays non-privileged pure numeric graph',()=>{
  const a=buildFactory('nonlinear2',3);
  assert.equal(JSON.stringify(a.graph).includes('eval'),false);
  assert.equal(JSON.stringify(a.graph).includes('fetch'),false);
  assert.equal(new WSPGraph(a.graph).evaluate(a.cases).correct,a.cases.length);
  assert.ok(inspectGraph(a.graph).stats.weights<10000);
});
test('graph operators square, sin, cosine, mean, dot, softmax, l2norm all work',()=>{
  const p=buildFactory('dot3',99);assert.equal(verifyFactory(p).correct,p.cases.length);
  for(const op of ['square1','sin1','cos1','softmax3','l2norm3','mean3']){
    const r=buildFactory(op,3);assert.equal(verifyFactory(r).correct,r.cases.length);
  }
});
test('bad graph operations and out-of-range picks are refused',()=>{
  const bad={name:'bad',inputs:['x'],nodes:[{id:'wrong',op:'pick',from:['x'],index:1}],outputs:['wrong']};
  assert.throws(()=>inspectGraph(bad),/pick/);
  assert.throws(()=>inspectGraph({...bad,nodes:[{id:'wrong',op:'network',from:['x']}]}),/未対応/);
});
test('factory does not modify installed graph until explicitly accepted',()=>{
  const live=new WSPGraph(),original=JSON.stringify(live.snapshot());
  const candidate=buildFactory('affine2',55),verify=verifyFactory(candidate);
  assert.equal(verify.correct,verify.total);
  assert.equal(JSON.stringify(live.snapshot()),original);
  live.install(candidate.graph,true);
  assert.notEqual(JSON.stringify(live.snapshot()),original);
  live.rollback();assert.equal(JSON.stringify(live.snapshot()),original);
});
test('cross-check numeric reference outputs',()=>{
  assert.deepEqual(referenceValue('multiply2',4,[2,3]),[3]);
  assert.deepEqual(referenceValue('xor2',0,[0,1]),[1]);
  assert.deepEqual(referenceValue('lut4',1,[0,0,0,0]),[1]);
});
