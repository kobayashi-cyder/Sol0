/** Sol-Zero v0.8: bounded, general-purpose weight-space graph runtime.
 * Inputs are explicit real vectors. No model downloads, pretrained tensors,
 * JavaScript eval, Function, network, or execution of arbitrary user code.
 * Acyclic operators, finite numerics, fixed memory/compute ceilings.
 */
export const GRAPH_LIMITS=Object.freeze({inputs:256,nodes:256,width:4096,weights:1000000,operations:3000000,outputs:32,checkpointBytes:3500000,truthBits:10,truthRows:1024});
const IDENT=/^[a-zA-Z][\w]{0,47}$/;
function fail(s){throw Error(s);}
function finite(x,label='数値'){if(typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e6)fail(`${label}は±1,000,000以内の有限数にしてください`);return x;}
function isVec(a){return Array.isArray(a)&&a.length>0&&a.length<=GRAPH_LIMITS.width&&a.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e6);}
function arr(x){return Array.isArray(x)?x:null;}
function clone(x){return JSON.parse(JSON.stringify(x));}
const unaryOps=new Set(['relu','tanh','sigmoid','abs','threshold','negate','square','sign','sin','cos','sqrtabs','softmax','l2norm']);
const multiOps=new Set(['concat','add','multiply','maximum','minimum','sum','mean','dot','pick']);
function validId(x){return typeof x==='string'&&IDENT.test(x);}
function clampNum(v){if(!Number.isFinite(v)||Math.abs(v)>1e12)fail('演算結果が範囲外です');return v;}
function product(a){return a.reduce((p,v)=>p*v,1);}
function assertInput(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.inputs)||!Array.isArray(raw.nodes)||!Array.isArray(raw.outputs))fail('回路JSONにはinputs、nodes、outputsが必要です');}
/** Validate shape, order, size, operator, and numerical bounds BEFORE any install. */
export function inspectGraph(raw){
  assertInput(raw);
  const name=typeof raw.name==='string'?raw.name.slice(0,80):'Untitled WSP graph';
  const ids=new Set(),shapes=new Map();let weights=0,operations=0;
  if(raw.inputs.length<1||raw.inputs.length>GRAPH_LIMITS.inputs)fail('入力は1〜256本までです');
  for(const x of raw.inputs){
    if(!validId(x)||ids.has(x))fail('入力IDは半角英数字で重複なしにしてください');
    ids.add(x);shapes.set(x,1);
  }
  if(raw.nodes.length<1||raw.nodes.length>GRAPH_LIMITS.nodes)fail('ノードは1〜256個までです');
  const nodes=[];
  for(const original of raw.nodes){
    if(!original||!validId(original.id)||ids.has(original.id))fail('ノードIDが不正か重複しています');
    if(!['linear','constant',...unaryOps,...multiOps].includes(original.op))fail(`未対応演算: ${String(original.op)}`);
    const node={id:original.id,op:original.op};let width=0;
    if(original.op==='constant'){
      if(!isVec(original.value))fail('constantのvalueが不正です');
      node.value=[...original.value];width=node.value.length;weights+=width;
    }else{
      if(!Array.isArray(original.from)||original.from.length<1||original.from.length>64||!original.from.every(s=>shapes.has(s)))fail(`参照先・並び順が不正です: ${node.id}`);
      node.from=[...original.from];const sizes=node.from.map(id=>shapes.get(id)),length=sizes.reduce((s,v)=>s+v,0);
      if(length>GRAPH_LIMITS.width)fail('入力ベクトルが長すぎます');
      if(original.op==='linear'){
        if(!Array.isArray(original.weights)||original.weights.length<1||original.weights.length>GRAPH_LIMITS.width)fail('linearの重み行列が不正です');
        if(!Array.isArray(original.bias)||original.bias.length!==original.weights.length)fail('linearのバイアス形状が不正です');
        if(weights + original.weights.length * (length + 1)>GRAPH_LIMITS.weights)fail('重みが100万個の上限を超えました');
        for(const row of original.weights){if(!Array.isArray(row)||row.length!==length)fail('重み行列と入力の次元が一致しません');for(const val of row)finite(val,'重み');}
        for(const val of original.bias)finite(val,'バイアス');
        node.weights=original.weights.map(x=>[...x]);node.bias=[...original.bias];
        node.activation=original.activation??'identity';
        if(!['identity','relu','tanh','sigmoid','threshold'].includes(node.activation))fail('活性化関数はidentity/relu/tanh/sigmoid/thresholdのみ');
        width=node.weights.length;weights+=width*(length+1);operations+=width*(length+1);
      }else if(unaryOps.has(node.op)){
        width=length;operations+=width*3;
        if(node.op==='threshold')node.threshold=finite(original.threshold??0.5,'閾値');
      }else if(node.op==='concat'){
        width=length;operations+=width;
      }else if(node.op==='sum'||node.op==='mean'){
        width=1;operations+=length;
      }else if(node.op==='pick'){
        if(node.from.length!==1||!Number.isInteger(original.index)||original.index<0||original.index>=sizes[0])fail('pickのindexが不正です');
        node.index=original.index;width=1;operations++;
      }else if(node.op==='dot'){
        if(sizes.length!==2||sizes[0]!==sizes[1])fail('dotは同じ次元の2ベクトルが必要です');
        width=1;operations+=2*sizes[0];
      }else {
        if(sizes.length<2||!sizes.every(x=>x===sizes[0]))fail('add/multiply/maximum/minimumは同じ幅の2本以上の入力が必要です');
        width=sizes[0];operations+=length;
      }
    }
    if(width<1||width>GRAPH_LIMITS.width)fail('ノードの出力幅が範囲外です');
    shapes.set(node.id,width);ids.add(node.id);nodes.push(node);
    if(weights>GRAPH_LIMITS.weights||operations>GRAPH_LIMITS.operations)fail('重みまたは演算量がブラウザ上限を超過しました');
  }
  if(!raw.outputs.length||raw.outputs.length>GRAPH_LIMITS.outputs||!raw.outputs.every(x=>shapes.has(x)))fail('出力の参照先が不正です');
  return {spec:{name,inputs:[...raw.inputs],nodes,outputs:[...raw.outputs]},stats:{inputs:raw.inputs.length,nodes:nodes.length,weights,operations,outputWidths:raw.outputs.map(x=>shapes.get(x)),weightBytes:weights*4}};
}
function act(x,k,t=0.5){
  if(k==='identity')return x;
  if(k==='relu')return Math.max(x,0);
  if(k==='tanh')return Math.tanh(x);
  if(k==='sigmoid')return x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));
  if(k==='threshold')return x>=t?1:0;
  if(k==='abs')return Math.abs(x);
  if(k==='negate')return -x;
  if(k==='square')return x*x;
  if(k==='sign')return Math.sign(x);
  if(k==='sin')return Math.sin(x);
  if(k==='cos')return Math.cos(x);
  if(k==='sqrtabs')return Math.sqrt(Math.abs(x));
  fail('不明な活性化関数');
}
export class WSPGraph {
  constructor(spec=GRAPH_DEMO_XOR){this.history=[];this.install(spec,false);}
  install(spec,savePrevious=true){const checked=inspectGraph(spec);if(savePrevious){this.history.push(this.snapshot());if(this.history.length>8)this.history.shift();}this.spec=checked.spec;this.stats=checked.stats;return this.stats;}
  snapshot(){return clone(this.spec);}
  restore(raw){try{this.install(raw,false);this.history=[];return true;}catch{return false;}}
  rollback(){const prev=this.history.pop();if(!prev)return false;this.install(prev,false);return true;}
  edit(nodeId,row,col,value){
    finite(value,'新しい重み');const spec=this.snapshot();const node=spec.nodes.find(x=>x.id===nodeId);
    if(!node||node.op!=='linear'||!Number.isInteger(row)||!Number.isInteger(col)||row<0||row>=node.weights.length||col<-1||col>=node.weights[row].length)fail('編集先の行列インデックスが不正です');
    const old=col===-1?node.bias[row]:node.weights[row][col];
    if(col===-1)node.bias[row]=value;else node.weights[row][col]=value;
    this.install(spec,true);return {nodeId,row,col,from:old,to:value};
  }
  run(raw){
    const vars=new Map();const isArray=Array.isArray(raw);
    if(isArray&&raw.length!==this.spec.inputs.length)fail('入力の本数が一致しません');
    if(!isArray&&(!raw||typeof raw!=='object'))fail('入力は数値配列または入力名→数値のオブジェクトにしてください');
    this.spec.inputs.forEach((key,i)=>vars.set(key,[finite(isArray?raw[i]:raw[key],key)]));
    let tally=0;
    for(const node of this.spec.nodes){
      let result;
      if(node.op==='constant'){result=[...node.value];}
      else{
        const arrays=node.from.map(k=>vars.get(k)),flat=arrays.flat();
        if(node.op==='linear'){
          result=node.weights.map((row,r)=>{
            let y=node.bias[r];for(let j=0;j<row.length;j++)y+=row[j]*flat[j];
            return act(clampNum(y),node.activation);
          });
        }else if(node.op==='softmax'){
          const max=Math.max(...flat),e=flat.map(v=>Math.exp(v-max)),z=e.reduce((a,b)=>a+b,0);result=e.map(v=>v/z);
        }else if(node.op==='l2norm'){
          const n=Math.hypot(...flat);result=n===0?flat.map(()=>0):flat.map(v=>v/n);
        }else if(unaryOps.has(node.op))result=flat.map(v=>act(v,node.op,node.threshold));
        else if(node.op==='concat')result=flat;
        else if(node.op==='sum')result=[flat.reduce((a,b)=>a+b,0)];
        else if(node.op==='mean')result=[flat.reduce((a,b)=>a+b,0)/flat.length];
        else if(node.op==='pick')result=[flat[node.index]];
        else if(node.op==='dot')result=[arrays[0].reduce((s,v,i)=>s+v*arrays[1][i],0)];
        else result=arrays[0].map((_,i)=>{
          const col=arrays.map(v=>v[i]);
          return node.op==='add'?col.reduce((a,b)=>a+b,0):node.op==='multiply'?product(col):node.op==='maximum'?Math.max(...col):Math.min(...col);
        });
      }
      result.forEach(clampNum);tally+=result.length;
      if(tally>GRAPH_LIMITS.operations)fail('実行量を超過しました');
      vars.set(node.id,result);
    }
    return {outputs:Object.fromEntries(this.spec.outputs.map(x=>[x,vars.get(x)])),values:Object.fromEntries(this.spec.nodes.map(x=>[x.id,vars.get(x.id)])),stats:this.stats};
  }
  evaluate(cases){
    if(!Array.isArray(cases)||cases.length<1||cases.length>1024)fail('テストは1〜1024件です');
    const rows=cases.map(c=>{
      if(!c||!Array.isArray(c.input)||!Array.isArray(c.expected))fail('テスト入力と期待値は配列が必要です');
      const actual=Object.values(this.run(c.input).outputs).flat();
      if(actual.length!==c.expected.length||!c.expected.every(x=>typeof x==='number'&&Number.isFinite(x)))fail('期待値の形状または数値が不正です');
      const tolerance=c.tolerance===undefined?1e-6:finite(c.tolerance,'許容誤差');
      if(tolerance<0||tolerance>0.1)fail('許容誤差は0〜0.1です');
      return {input:c.input,expected:c.expected,actual,passed:actual.every((v,i)=>Math.abs(v-c.expected[i])<=tolerance)};
    });
    return {correct:rows.filter(x=>x.passed).length,total:rows.length,accuracy:rows.filter(x=>x.passed).length/rows.length,rows};
  }
}
/** Truth table -> 2-layer ReLU network without gradient training.
 * Each positive minterm is one ReLU, output is a thresholded sum of minterms.
 * Unspecified binary combinations default to zero, NOT inferred.
 */
export function compileTruthTable(raw){
  if(!raw||typeof raw!=='object'||!Array.isArray(raw.inputs)||!Array.isArray(raw.rows))fail('truth table: inputsとrowsを指定してください');
  const names=raw.inputs;
  if(!names.length||names.length>GRAPH_LIMITS.truthBits||new Set(names).size!==names.length||!names.every(validId))fail('真理値表の入力は1〜10変数です');
  if(!raw.rows.length||raw.rows.length>Math.min(GRAPH_LIMITS.truthRows,2**names.length))fail('真理値表の行数が不正です');
  const unique=new Set();let outputs=null;const positive=[];
  for(const r of raw.rows){
    if(!r||!Array.isArray(r.input)||r.input.length!==names.length||!r.input.every(x=>x===0||x===1))fail('入力は0/1配列です');
    const y=Array.isArray(r.output)?r.output:[r.output];
    if(!y.length||y.length>8||!y.every(x=>x===0||x===1)|| (outputs!==null&&outputs!==y.length))fail('出力は0/1、最大8本です');
    outputs=y.length;const k=r.input.join('');if(unique.has(k))fail('真理値表に重複があります');unique.add(k);
    if(y.some(Boolean))positive.push({x:r.input,y});
  }
  const nodes=[];
  if(positive.length){
    // minterm score equals 1 only when every literal matches; 0 otherwise.
    const rows=positive.map(({x})=>x.map(bit=>bit?1:-1));
    const biases=positive.map(({x})=>x.filter(bit=>bit===0).length-names.length+1);
    nodes.push({id:'minterms',op:'linear',from:names,weights:rows,bias:biases,activation:'relu'});
    const outputRows=Array.from({length:outputs},(_,k)=>positive.map(({y})=>y[k]));
    nodes.push({id:'output',op:'linear',from:['minterms'],weights:outputRows,bias:Array(outputs).fill(0),activation:'threshold'});
  }else nodes.push({id:'output',op:'constant',value:Array(outputs).fill(0)});
  const graph={name:typeof raw.name==='string'?raw.name.slice(0,80):'Truth table WSP',inputs:[...names],nodes,outputs:['output']};
  const inspected=inspectGraph(graph),circuit=new WSPGraph(graph);
  const training=circuit.evaluate(raw.rows.map(r=>({input:r.input,expected:Array.isArray(r.output)?r.output:[r.output]})));
  if(training.correct!==training.total)fail('回路生成後の真理値表検証が不合格です');
  return {graph:inspected.spec,training,stats:inspected.stats,covered:unique.size,totalPossibilities:2**names.length,complete:unique.size===2**names.length};
}
/** Seeded but NOT trained: configurable dense weight matrices. Zero external weights. */
export function denseTemplate({inputs=2,width=8,layers=2,outputs=1,seed=1234}={}){
  for(const [label,n,min,max] of [['inputs',inputs,1,32],['width',width,1,1024],['layers',layers,0,12],['outputs',outputs,1,32],['seed',seed,1,2147483647]])
    if(!Number.isInteger(n)||n<min||n>max)fail(`${label}は${min}〜${max}の整数です`);
  const required=layers===0?outputs*(inputs+1):width*(inputs+1)+(layers-1)*width*(width+1)+outputs*(width+1);
  if(required>GRAPH_LIMITS.weights)fail('密な行列が重み上限を超えました。widthまたはlayersを減らしてください');
  let state=seed|0;function rnd(){state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;}
  const names=Array.from({length:inputs},(_,i)=>`x${i}`);const nodes=[];let refs=names;
  for(let l=0;l<=layers;l++){
    const fromWidth=l===0?inputs:width,outWidth=l===layers?outputs:width;
    const count=outWidth*(fromWidth+1);
    const used=nodes.reduce((s,n)=>s+n.weights.length*(n.weights[0].length+1),0);
    if(used+count>GRAPH_LIMITS.weights)fail('密な行列が重み上限を超えました。widthまたはlayersを減らしてください');
    const scale=Math.sqrt(2/fromWidth);
    const weights=Array.from({length:outWidth},()=>Array.from({length:fromWidth},()=>(rnd()*2-1)*scale));
    const id=`layer${l}`;
    nodes.push({id,op:'linear',from:refs,weights,bias:Array(outWidth).fill(0),activation:l===layers?'identity':'relu'});
    refs=[id];
  }
  return {name:`Scratch dense ${inputs}x${width}x${outputs}, layers=${layers}`,inputs:names,nodes,outputs:refs};
}
export const GRAPH_DEMO_XOR=Object.freeze({name:'WSP XOR: no learned weights',inputs:['a','b'],nodes:[
  {id:'hidden',op:'linear',from:['a','b'],weights:[[1,-1],[-1,1]],bias:[0,0],activation:'relu'},
  {id:'xor',op:'sum',from:['hidden']}
],outputs:['xor']});
export const GRAPH_DEMO_NUMERIC=Object.freeze({name:'WSP calculation: z=max(0,2a-3b+1)',inputs:['a','b'],nodes:[
  {id:'z',op:'linear',from:['a','b'],weights:[[2,-3]],bias:[1],activation:'relu'}
],outputs:['z']});
export const GRAPH_DEMO_PARITY=Object.freeze({name:'WSP 3-bit parity',inputs:['a','b','c'],rows:Array.from({length:8},(_,k)=>({input:[k>>2&1,k>>1&1,k&1],output:((k>>2&1)+(k>>1&1)+(k&1))%2}))});
