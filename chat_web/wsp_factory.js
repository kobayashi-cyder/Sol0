/** Sol-Zero v0.9: zero-pretrained, deterministic WSP circuit factory.
 * A recipe is a parameterized SPECIFICATION, not a stored/learned skill.
 * LUT4 indexes all 65,536 distinct four-bit Boolean functions; compile on demand.
 */
import {WSPGraph,inspectGraph,compileTruthTable} from './wsp_graph.js';

const FAMILY_ROWS=[
 ['affine1','1変数一次関数','数値',1],['affine2','2変数一次関数','数値',2],
 ['add2','加算','算術',2],['subtract2','減算','算術',2],['multiply2','乗算','算術',2],
 ['maximum2','最大値','算術',2],['minimum2','最小値','算術',2],['absdiff2','絶対差','算術',2],
 ['relu_shift1','ReLUしきい値','非線形',1],['sigmoid1','Sigmoid','非線形',1],
 ['tanh1','Tanh','非線形',1],['step1','しきい値判定','判定',1],
 ['between1','範囲内判定','判定',1],['compare2','2値比較','判定',2],
 ['and2','AND','論理',2],['or2','OR','論理',2],['xor2','XOR','論理',2],
 ['majority3','3入力多数決','論理',3],['boolean3','3入力任意論理','論理',3],
 ['clamp1','上限下限クリップ','数値',1],['square1','二乗','非線形',1],
 ['sin1','正弦','非線形',1],['cos1','余弦','非線形',1],
 ['mean3','平均値','統計',3],['dot3','3次元内積','ベクトル',6],
 ['softmax3','Softmax分布','ベクトル',3],['l2norm3','単位ベクトル化','ベクトル',3],
 ['projection3','3→2次元射影','ベクトル',3],['nonlinear2','二乗＋正弦結合','複合',2],
 ['lut4','4入力全論理関数','論理',4]
];
export const FACTORY_FAMILIES=Object.freeze(FAMILY_ROWS.map(([id,label,category,inputs])=>Object.freeze({id,label,category,inputs,variants:id==='lut4'?65536:id==='boolean3'?256:4096})));
const FAMILY_MAP=new Map(FACTORY_FAMILIES.map(x=>[x.id,x]));
export const FACTORY_LIMITS=Object.freeze({batch:512,stages:8,maxVariants:65536,distinctBoolean4:65536});
function bad(msg){throw Error(msg);}
const COEFS=[-3,-2,-1,-0.5,0.5,1,1.5,2,3,4];
function parameters(v){return {k:COEFS[v%COEFS.length],b:(Math.floor(v/COEFS.length)%21-10)/4,t:(Math.floor(v/7)%17-8)/4,lo:(Math.floor(v/11)%9-7)/2};}
function lin(id,from,weights,bias,activation='identity'){return {id,op:'linear',from,weights,bias,activation};}
function unary(id,op,from){return {id,op,from};}
function scalar(x){return [x];}
function sigmoid(x){return x>=0?1/(1+Math.exp(-x)):Math.exp(x)/(1+Math.exp(x));}
function bools(n){return Array.from({length:2**n},(_,v)=>Array.from({length:n},(_,j)=>(v>>(n-j-1))&1));}
function numericCases(n){const examples=[];for(let r=0;r<10;r++)examples.push(Array.from({length:n},(_,j)=>((r*3+j*7)%11-5)/2));return examples;}
function bit(mask,index){return (mask>>index)&1;}
function expected(family,variant,x){
 const p=parameters(variant),[a,b,c,d,e,f]=x,k=p.k;
 switch(family){
 case 'affine1':return scalar(k*a+p.b);
 case 'affine2':return scalar(k*a+(k/2)*b+p.b);
 case 'add2':return scalar(k*(a+b)+p.b);
 case 'subtract2':return scalar(k*(a-b)+p.b);
 case 'multiply2':return scalar(k*a*b);
 case 'maximum2':return scalar(k*Math.max(a,b)+p.b);
 case 'minimum2':return scalar(k*Math.min(a,b)+p.b);
 case 'absdiff2':return scalar(Math.abs(k*(a-b)));
 case 'relu_shift1':return scalar(Math.max(0,a-p.t));
 case 'sigmoid1':return scalar(sigmoid(k*a+p.b));
 case 'tanh1':return scalar(Math.tanh(k*a+p.b));
 case 'step1':return scalar(a>=p.t?1:0);
 case 'between1':return scalar(a>=p.lo && a<=p.lo+2?1:0);
 case 'compare2':return scalar(a-b>=p.t?1:0);
 case 'and2':return scalar(a&&b?1:0);
 case 'or2':return scalar(a||b?1:0);
 case 'xor2':return scalar(a!==b?1:0);
 case 'majority3':return scalar((a+b+c)>=2?1:0);
 case 'boolean3':return scalar(bit(variant,a*4+b*2+c));
 case 'clamp1':return scalar(Math.max(p.lo,Math.min(p.lo+2,a)));
 case 'square1':return scalar(k*a*a);
 case 'sin1':return scalar(k*Math.sin(a));
 case 'cos1':return scalar(k*Math.cos(a));
 case 'mean3':return scalar(k*(a+b+c)/3);
 case 'dot3':return scalar(k*(a*d+b*e+c*f));
 case 'softmax3':{const t=[k*a,k*b,k*c],m=Math.max(...t),v=t.map(z=>Math.exp(z-m)),s=v.reduce((sum,z)=>sum+z,0);return v.map(z=>z/s);}
 case 'l2norm3':{const t=[k*a,b,c],norm=Math.hypot(...t);return norm?t.map(z=>z/norm):[0,0,0];}
 case 'projection3':return [k*a+b/2+p.b, k*b-c/2];
 case 'nonlinear2':return scalar(k*(a*a+Math.sin(b)));
 case 'lut4':return scalar(bit(variant,a*8+b*4+c*2+d));
 default:bad('未知のファミリー');
 }
}
export function referenceValue(family,variant,input){validateRecipe(family,variant);if(!Array.isArray(input)||input.length!==FAMILY_MAP.get(family).inputs||!input.every(n=>typeof n==='number'&&Number.isFinite(n)))bad('参照値の入力が不正です');return expected(family,variant,input);}
function validateRecipe(family,variant){const item=FAMILY_MAP.get(family);if(!item)bad('回路ファミリーが存在しません');if(!Number.isInteger(variant)||variant<0||variant>=item.variants)bad(`設定番号は0〜${item.variants-1}`);return item;}

export function buildFactory(family,variant=0){
 const item=validateRecipe(family,variant),p=parameters(variant),{k,b,t,lo}=p;
 const names=Array.from({length:item.inputs},(_,i)=>`x${i}`);
 const nodes=[];let outputs=['result'];
 const l=(from,ws,bias,activation='identity')=>nodes.push(lin('result',from,ws,bias,activation));
 const calc=(id,op,from)=>nodes.push(unary(id,op,from));
 if(family==='affine1')l(names,[[k]],[b]);
 else if(family==='affine2')l(names,[[k,k/2]],[b]);
 else if(family==='add2')l(names,[[k,k]],[b]);
 else if(family==='subtract2')l(names,[[k,-k]],[b]);
 else if(family==='multiply2'||family==='maximum2'||family==='minimum2'){
   calc('mid',family==='multiply2'?'multiply':family==='maximum2'?'maximum':'minimum',names);
   l(['mid'],[[k]],[family==='multiply2'?0:b]);
 }
 else if(family==='absdiff2'){nodes.push(lin('mid',names,[[k,-k]],[0]));calc('result','abs',['mid']);}
 else if(family==='relu_shift1')l(names,[[1]],[-t],'relu');
 else if(family==='sigmoid1')l(names,[[k]],[b],'sigmoid');
 else if(family==='tanh1')l(names,[[k]],[b],'tanh');
 else if(family==='step1')l(names,[[1]],[0.5-t],'threshold');
 else if(family==='between1'){
   nodes.push(lin('lower',names,[[1]],[0.5-lo],'threshold'),lin('upper',names,[[-1]],[0.5+lo+2],'threshold'));
   calc('result','multiply',['lower','upper']);
 }
 else if(family==='compare2')l(names,[[1,-1]],[0.5-t],'threshold');
 else if(family==='and2')l(names,[[1,1]],[-1.5],'threshold');
 else if(family==='or2')l(names,[[1,1]],[0],'threshold');
 else if(family==='xor2'){
   nodes.push(lin('h',names,[[1,-1],[-1,1]],[0,0],'relu'));
   calc('result','sum',['h']);
 }
 else if(family==='majority3')l(names,[[1,1,1]],[-1],'threshold');
 else if(family==='boolean3'||family==='lut4'){
   const rows=bools(item.inputs).map(x=>({input:x,output:expected(family,variant,x)[0]}));
   const out=compileTruthTable({name:`${family}-${variant}`,inputs:names,rows});
   return makeResult(item,variant,out.graph,true);
 }
 else if(family==='clamp1'){
   nodes.push({id:'low',op:'constant',value:[lo]},{id:'high',op:'constant',value:[lo+2]});
   calc('lowBound','maximum',['x0','low']);calc('result','minimum',['lowBound','high']);
 }
 else if(family==='square1'||family==='sin1'||family==='cos1'){
   calc('nonlinear',family==='square1'?'square':family==='sin1'?'sin':'cos',names);
   l(['nonlinear'],[[k]],[0]);
 }
 else if(family==='mean3'){
   calc('mean','mean',names);l(['mean'],[[k]],[0]);
 }
 else if(family==='dot3'){
   calc('left','concat',names.slice(0,3));calc('right','concat',names.slice(3));
   calc('raw','dot',['left','right']);l(['raw'],[[k]],[0]);
 }
 else if(family==='softmax3'){
   nodes.push(lin('scores',names,[[k,0,0],[0,k,0],[0,0,k]],[0,0,0]));
   calc('result','softmax',['scores']);
 }
 else if(family==='l2norm3'){
   nodes.push(lin('coords',names,[[k,0,0],[0,1,0],[0,0,1]],[0,0,0]));
   calc('result','l2norm',['coords']);
 }
 else if(family==='projection3')l(names,[[k,0.5,0],[0,k,-0.5]],[b,0]);
 else if(family==='nonlinear2'){
   calc('aSquared','square',['x0']);calc('bSin','sin',['x1']);
   calc('added','add',['aSquared','bSin']);l(['added'],[[k]],[0]);
 }
 else bad('指定された回路ファミリーは未実装です');
 return makeResult(item,variant,{name:`WSP Factory / ${item.label} #${variant}`,inputs:names,nodes,outputs},false);
}
function makeResult(item,variant,graph,exhaustive){
 const checked=inspectGraph(graph),cases=(item.category==='論理'?bools(item.inputs):numericCases(item.inputs)).map(input=>({input,expected:expected(item.id,variant,input),tolerance:1e-7}));
 return {family:item.id,variant,label:item.label,category:item.category,graph:checked.spec,stats:checked.stats,cases,exhaustive:exhaustive||item.category==='論理',summary:`${item.label} #${variant} (${checked.stats.weights}重み)`};
}
/** Evaluate a hand-programmed circuit against a separately computed mathematical oracle. */
export function verifyFactory(recipe){const g=new WSPGraph(recipe.graph),r=g.evaluate(recipe.cases);return {...r,recipe:recipe.family,index:recipe.variant,exhaustive:recipe.exhaustive};}
export function auditFactory(family='lut4',start=0,count=64){
 const item=validateRecipe(family,start);
 if(!Number.isInteger(count)||count<1||count>FACTORY_LIMITS.batch||start+count>item.variants)bad(`一括テストは1〜${FACTORY_LIMITS.batch}件で、範囲外を拒否します`);
 let passed=0,failed=0,verifiedCases=0,weights=0;const errors=[];
 for(let v=start;v<start+count;v++){
   try{const recipe=buildFactory(family,v),r=verifyFactory(recipe);verifiedCases+=r.total;weights+=recipe.stats.weights;
     if(r.correct===r.total)passed++;else{failed++;if(errors.length<6)errors.push({index:v,correct:r.correct,total:r.total});}
   }catch(err){failed++;if(errors.length<6)errors.push({index:v,error:String(err.message)});}
 }
 return {family,start,count,passed,failed,verifiedCases,virtualWeightCount:weights,errors,materialized:false};
}
/** Merge 2-8 recipe circuits in series (output scalar dims feed the next input). */
export function composeFactories(stages){
 if(!Array.isArray(stages)||stages.length<2||stages.length>FACTORY_LIMITS.stages)bad('直列合成は2〜8段です');
 const components=stages.map(s=>buildFactory(s.family,s.variant??0));
 const nodes=[];let inputs=[],currentRefs=[];
 for(let i=0;i<components.length;i++){
   const g=components[i].graph,mapping=new Map();
   if(i===0){inputs=[...g.inputs];for(const id of g.inputs)mapping.set(id,id);}
   else{
     if(currentRefs.length!==g.inputs.length)bad(`段階${i+1}: 出力次元${currentRefs.length}と入力数${g.inputs.length}が不一致です`);
     for(let j=0;j<g.inputs.length;j++)mapping.set(g.inputs[j],currentRefs[j]);
   }
   for(const n of g.nodes){
     const copy=JSON.parse(JSON.stringify(n));copy.id=`g${i}_${n.id}`;
     if(copy.from)copy.from=copy.from.map(id=>{if(!mapping.has(id))bad('参照先の解決に失敗しました');return mapping.get(id);});
     nodes.push(copy);mapping.set(n.id,copy.id);
   }
   const widths=inspectGraph(g).stats.outputWidths;currentRefs=[];
   for(let j=0;j<g.outputs.length;j++){
     const output=mapping.get(g.outputs[j]);
     if(widths[j]===1)currentRefs.push(output);
     else for(let k=0;k<widths[j];k++){
       const pick=`g${i}_split${j}_${k}`;
       nodes.push({id:pick,op:'pick',from:[output],index:k});currentRefs.push(pick);
     }
   }
 }
 const graph={name:`WSP pipeline: ${stages.map(s=>s.family).join(' > ')}`,inputs,nodes,outputs:currentRefs};
 const checked=inspectGraph(graph),source=components[0],cases=source.cases.map(row=>{
   let output=row.input;
   for(const stage of components)output=expected(stage.family,stage.variant,output);
   return {input:row.input,expected:output,tolerance:1e-6};
 });
 const r=new WSPGraph(graph).evaluate(cases);
 return {graph:checked.spec,stats:checked.stats,cases,verified:r.correct===r.total,verification:r,stages:stages.map(x=>({family:x.family,variant:x.variant??0}))};
}
