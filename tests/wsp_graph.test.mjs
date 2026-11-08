import test from 'node:test';
import assert from 'node:assert/strict';
import {WSPGraph,inspectGraph,compileTruthTable,denseTemplate,GRAPH_DEMO_XOR,GRAPH_DEMO_NUMERIC,GRAPH_DEMO_PARITY,GRAPH_LIMITS} from '../chat_web/wsp_graph.js';

test('zero-pretrained XOR 4/4 direct WSP weights',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR);
  assert.equal(g.stats.weights,6);
  for(const [a,b,y] of [[0,0,0],[0,1,1],[1,0,1],[1,1,0]])assert.equal(g.run([a,b]).outputs.xor[0],y);
});
test('numeric ReLU expression and graph composition',()=>{
  const g=new WSPGraph(GRAPH_DEMO_NUMERIC);
  assert.equal(g.run([3,2]).outputs.z[0],1);
  assert.equal(g.run([0,1]).outputs.z[0],0);
  const h=new WSPGraph({inputs:['x','y'],nodes:[
    {id:'s',op:'add',from:['x','y']},{id:'p',op:'multiply',from:['x','y']},
    {id:'c',op:'concat',from:['s','p']},{id:'m',op:'maximum',from:['s','p']},
    {id:'n',op:'sigmoid',from:['m']},
  ],outputs:['c','n']});
  const r=h.run([3,2]);assert.deepEqual(r.outputs.c,[5,6]);assert.ok(r.outputs.n[0]>0.99);
});
test('truth table automatically synthesizes full 3-bit parity',()=>{
  const built=compileTruthTable(GRAPH_DEMO_PARITY);
  assert.equal(built.training.correct,8);assert.equal(built.covered,8);assert.equal(built.complete,true);
  assert.equal(built.stats.weights,4*(3+1)+1*(4+1));
  const g=new WSPGraph(built.graph);
  assert.equal(g.evaluate(GRAPH_DEMO_PARITY.rows.map(r=>({input:r.input,expected:[r.output]}))).accuracy,1);
});
test('arbitrary multi-output maps from truth table',()=>{
  const cases=[0,1,2,3].map(n=>({input:[n>>1&1,n&1],output:[(n>>1&1)^(n&1),(n>>1&1)&(n&1)]}));
  const b=compileTruthTable({inputs:['a','b'],rows:cases});
  assert.equal(b.training.correct,4);
  assert.deepEqual(new WSPGraph(b.graph).run([1,1]).outputs.output,[0,1]);
});
test('partial truth table explicitly reports incomplete coverage',()=>{
  const b=compileTruthTable({inputs:['x','y'],rows:[{input:[0,0],output:1},{input:[1,1],output:0}]});
  assert.equal(b.complete,false);assert.equal(b.covered,2);
  assert.deepEqual(new WSPGraph(b.graph).run([0,1]).outputs.output,[0]);
});
test('reject duplicate and invalid truth rows',()=>{
  assert.throws(()=>compileTruthTable({inputs:['x'],rows:[{input:[1],output:0},{input:[1],output:1}]}),/重複/);
  assert.throws(()=>compileTruthTable({inputs:['x'],rows:[{input:[0.1],output:0}]}),/0\/1/);
});
test('real-valued inputs accepted; wrong shapes rejected',()=>{
  const g=new WSPGraph(GRAPH_DEMO_NUMERIC);
  assert.equal(g.run({a:-1,b:2}).outputs.z[0],0);
  for(const bad of [[1], [1,NaN],[1,Infinity]])assert.throws(()=>g.run(bad));
});
test('refuse cycles and unknown inputs',()=>{
  const x={inputs:['x'],nodes:[{id:'a',op:'relu',from:['b']},{id:'b',op:'relu',from:['a']}],outputs:['b']};
  assert.throws(()=>inspectGraph(x),/参照先/);
  assert.throws(()=>inspectGraph({...x,nodes:[{id:'a',op:'eval',from:['x']}],outputs:['a']}),/未対応/);
});
test('reject excessive weight count before allocating',()=>{
  const bad={inputs:['x'],nodes:[{id:'n',op:'linear',from:['x'],weights:[[1,2]],bias:[0]}],outputs:['n']};
  assert.throws(()=>inspectGraph(bad),/次元/);
});
test('direct patch and rollback returns original behavior',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR);
  const before=g.run([1,0]).outputs.xor[0];
  const r=g.edit('hidden',0,0,-2);
  assert.equal(r.from,1);assert.equal(r.to,-2);
  assert.notEqual(g.run([1,0]).outputs.xor[0],before);
  assert.equal(g.rollback(),true);assert.equal(g.run([1,0]).outputs.xor[0],before);
  assert.equal(g.rollback(),false);
});
test('invalid edit is atomic',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR);const before=JSON.stringify(g.snapshot());
  assert.throws(()=>g.edit('hidden',0,99,5));assert.throws(()=>g.edit('hidden',0,0,Infinity));
  assert.equal(JSON.stringify(g.snapshot()),before);assert.equal(g.history.length,0);
});
test('install invalid spec is atomic',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR);const before=g.snapshot();
  assert.throws(()=>g.install({...GRAPH_DEMO_XOR,outputs:['hijack']},true));
  assert.deepEqual(g.snapshot(),before);
});
test('restore invalid data refuses without changing state',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR);const before=g.snapshot();
  assert.equal(g.restore({inputs:['x'],nodes:[{id:'s',op:'constant',value:[NaN]}],outputs:['s']}),false);
  assert.deepEqual(g.snapshot(),before);
});
test('evaluate reports failures and values',()=>{
  const g=new WSPGraph(GRAPH_DEMO_XOR);const r=g.evaluate([{input:[0,1],expected:[0]},{input:[1,1],expected:[0]}]);
  assert.equal(r.correct,1);assert.equal(r.total,2);assert.equal(r.rows[0].actual[0],1);
});
test('random scratch dense generator deterministic and shape-safe',()=>{
  const a=denseTemplate({inputs:3,width:16,layers:4,outputs:2,seed:2026});
  const b=denseTemplate({inputs:3,width:16,layers:4,outputs:2,seed:2026});
  assert.deepEqual(a,b);
  const g=new WSPGraph(a);assert.equal(g.run([1,2,3]).outputs.layer4.length,2);
  assert.ok(g.stats.weights>800);
});
test('random dense generator rejects browser-dangerous allocations',()=>{
  assert.throws(()=>denseTemplate({inputs:32,width:1024,layers:12,outputs:32,seed:8}),/重み上限/);
  assert.throws(()=>denseTemplate({inputs:2,width:5,layers:2,outputs:2,seed:0}),/整数/);
});
test('network and arbitrary code cannot be referenced as an op',()=>{
  for(const op of ['fetch','eval','Function','javascript','os_shell']){
    assert.throws(()=>inspectGraph({inputs:['x'],nodes:[{id:'a',op,from:['x']}],outputs:['a']}),/未対応/);
  }
});
test('ops and budget ceilings are explicitly bounded',()=>{
  assert.equal(GRAPH_LIMITS.weights,1000000);
  assert.equal(GRAPH_LIMITS.truthBits,10);
  const g=new WSPGraph(GRAPH_DEMO_XOR);
  assert.ok(JSON.stringify(g.snapshot()).length<5000);
});
