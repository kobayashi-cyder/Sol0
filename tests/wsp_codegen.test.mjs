import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {generateWSPCode,WSP_EXPORT_LIMIT} from '../chat_web/wsp_codegen.js';
import {WSPGraph,GRAPH_DEMO_XOR,GRAPH_DEMO_NUMERIC} from '../chat_web/wsp_graph.js';

const example = {name:'Full operators / unsafe name </script> \' ',inputs:['a','b'],nodes:[
  {id:'left',op:'linear',from:['a','b'],weights:[[1.25,-.5],[-2,1]],bias:[.5,1],activation:'identity'},
  {id:'right',op:'constant',value:[1.1,-.8]},
  {id:'added',op:'add',from:['left','right']},
  {id:'mult',op:'multiply',from:['left','right']},
  {id:'biggest',op:'maximum',from:['left','right']},
  {id:'smallest',op:'minimum',from:['left','right']},
  {id:'prob',op:'softmax',from:['added']},
  {id:'unit',op:'l2norm',from:['mult']},
  {id:'merged',op:'concat',from:['prob','unit']},
  {id:'meanvalue',op:'mean',from:['merged']},
  {id:'pick',op:'pick',from:['merged'],index:1},
  {id:'dotvalue',op:'dot',from:['left','right']},
  {id:'sumvalue',op:'sum',from:['merged']},
  {id:'positive',op:'relu',from:['left']},
  {id:'signs',op:'sign',from:['left']},
  {id:'angle',op:'sin',from:['left']},
  {id:'cosine',op:'cos',from:['left']},
  {id:'square',op:'square',from:['left']},
  {id:'negative',op:'negate',from:['left']},
  {id:'absolute',op:'abs',from:['left']},
  {id:'sqrtabs',op:'sqrtabs',from:['left']},
  {id:'thresholded',op:'threshold',from:['left'],threshold:.2},
  {id:'squashed',op:'sigmoid',from:['left']},
  {id:'smoothed',op:'tanh',from:['left']},
  {id:'identity',op:'linear',from:['a'],weights:[[1]],bias:[0]},
 ],outputs:['left','added','mult','biggest','smallest','prob','unit','merged','meanvalue','pick','dotvalue','sumvalue','positive','signs','angle','cosine','square','negative','absolute','sqrtabs','thresholded','squashed','smoothed','identity']};

function jsValue(code,inputs){
 const context=vm.createContext({});new vm.Script(code+'\n;globalThis.output=wsp_predict('+JSON.stringify(inputs)+');',{timeout:4000}).runInContext(context,{timeout:4000});
 return JSON.parse(JSON.stringify(context.output));
}
function pyValue(code,inputs){
 const child=spawnSync('python',['-c',code+'\nprint(json.dumps(wsp_predict('+JSON.stringify(inputs)+')))'],{encoding:'utf8',timeout:5000,maxBuffer:1_000_000});
 assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout.trim());
}
function near(a,b){
 assert.deepEqual(Object.keys(a),Object.keys(b));
 for(const k of Object.keys(a)){
  assert.equal(a[k].length,b[k].length,k);
  for(let i=0;i<a[k].length;i++)assert.ok(Math.abs(a[k][i]-b[k][i])<=1e-9*Math.max(1,Math.abs(a[k][i]),Math.abs(b[k][i])),`${k}/${i}: ${a[k][i]} vs ${b[k][i]}`);
 }
}
for(const graph of [GRAPH_DEMO_XOR,GRAPH_DEMO_NUMERIC,example]){
 test(`WSP export Python/JavaScript agree with numeric reference: ${graph.name}`,()=>{
  const reference=new WSPGraph(graph);const js=generateWSPCode(graph,'javascript'),py=generateWSPCode(graph,'python');
  assert.ok(js.code.includes('function wsp_predict'));
  assert.ok(py.code.includes('def wsp_predict'));
  assert.ok(js.code.length<200_000&&py.code.length<200_000);
  for(let n=0;n<5;n++){
   const inputs=graph.inputs.map((_,i)=>(n-2)*1.375+i*.5);
   const expected=reference.run(inputs).outputs;
   near(expected,jsValue(js.code,inputs));near(expected,pyValue(py.code,inputs));
  }
 });
}
test('reject invalid graph, unsupported languages and oversized embedding',()=>{
 assert.throws(()=>generateWSPCode({name:'bad',inputs:['x'],nodes:[{id:'n',op:'fetch',from:['x']}],outputs:['n']},'python'),/未対応|invalid/);
 assert.throws(()=>generateWSPCode(GRAPH_DEMO_XOR,'ruby'),/python/);
 assert.equal(WSP_EXPORT_LIMIT,120_000);
 const oversized={name:'too large',inputs:['x'],nodes:[{id:'n',op:'constant',value:Array.from({length:4096},(_,i)=>i)}],outputs:['n']};
 assert.doesNotThrow(()=>generateWSPCode(oversized,'python'));
 assert.throws(()=>generateWSPCode({...oversized,nodes:[...oversized.nodes,{id:'n2',op:'linear',from:['n'],weights:Array.from({length:16},()=>Array(4096).fill(1)),bias:Array(16).fill(0)}],outputs:['n2']},'python'),/120KB/);
});
test('published code rejects mismatched and non-finite input (without running user scripts)',()=>{
 const src=generateWSPCode(GRAPH_DEMO_NUMERIC,'javascript').code;
 assert.throws(()=>jsValue(src,[1]),/input shape/);
 assert.throws(()=>jsValue(src,[NaN,1]),/nonfinite/);
});