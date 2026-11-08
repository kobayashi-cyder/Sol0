/** Trainable WSP network: learned dense weights, not a catalogue of procedures.
 * No pretrained weights, network, eval or arbitrary user-supplied code execution.
 */
export const NEURAL_LIMITS=Object.freeze({inputs:8,outputs:4,hidden:24,minTrain:6,maxTrain:64,minHoldout:3,maxHoldout:32,epochs:1600,maxInput:1000,maxOutput:10000});
const verified=new WeakMap();
const safe=x=>typeof x==='number'&&Number.isFinite(x);
const copy=x=>JSON.parse(JSON.stringify(x));
function fail(s){throw Error('WSP学習拒否：'+s);}
function checkRows(rows,n,m,label,min,max){
 if(!Array.isArray(rows)||rows.length<min||rows.length>max)fail(label+'の件数が範囲外');
 return rows.map((r,i)=>{
  if(!r||!Array.isArray(r.input)||r.input.length!==n||!r.input.every(x=>safe(x)&&Math.abs(x)<=NEURAL_LIMITS.maxInput)||
     !Array.isArray(r.output)||r.output.length!==m||!r.output.every(x=>safe(x)&&Math.abs(x)<=NEURAL_LIMITS.maxOutput))
   fail(label+(i+1)+'は次元内の有限数値にしてください');
  return {input:[...r.input],output:[...r.output]};
 });
}
export function validateNeuralTask(task){
 if(!task||typeof task!=='object'||Array.isArray(task))fail('学習タスクはJSONオブジェクトです');
 const {inputs,outputs,hidden=12,seed=2026,epochs=1000,tolerance=0.15}=task;
 if(!Number.isInteger(inputs)||inputs<1||inputs>NEURAL_LIMITS.inputs||
    !Number.isInteger(outputs)||outputs<1||outputs>NEURAL_LIMITS.outputs||
    !Number.isInteger(hidden)||hidden<4||hidden>NEURAL_LIMITS.hidden||
    !Number.isInteger(seed)||seed<0||seed>0xffffffff||
    !Number.isInteger(epochs)||epochs<50||epochs>NEURAL_LIMITS.epochs||
    !safe(tolerance)||tolerance<=0||tolerance>10)fail('入出力次元・隠れ数・種・学習回数・許容誤差が不正');
 const train=checkRows(task.train,inputs,outputs,'訓練',NEURAL_LIMITS.minTrain,NEURAL_LIMITS.maxTrain);
 const holdout=checkRows(task.holdout,inputs,outputs,'未使用評価',NEURAL_LIMITS.minHoldout,NEURAL_LIMITS.maxHoldout);
 const seen=new Set();for(const group of [train,holdout])for(const r of group){
  const key=JSON.stringify(r.input);if(seen.has(key))fail('訓練と未使用評価の入力が重複');seen.add(key);
 }
 if(epochs*train.length*(hidden*(inputs+1)+(hidden+1)*outputs)>8_000_000)fail('学習演算上限を超えました');
 return {inputs,outputs,hidden,seed,epochs,tolerance,train,holdout};
}
function rng(seed){let x=(seed>>>0)||0x517cc1b7;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
function meanStd(rows,key,dim){
 const mean=Array(dim).fill(0),scale=Array(dim).fill(0);
 for(const r of rows)for(let i=0;i<dim;i++)mean[i]+=r[key][i]/rows.length;
 for(const r of rows)for(let i=0;i<dim;i++)scale[i]+=(r[key][i]-mean[i])**2/rows.length;
 return {mean,scale:scale.map(x=>Math.max(Math.sqrt(x),0.1))};
}
function checkModel(m){
 if(!m||typeof m!=='object'||Array.isArray(m)||m.version!==1||
    !Number.isInteger(m.inputs)||m.inputs<1||m.inputs>NEURAL_LIMITS.inputs||
    !Number.isInteger(m.outputs)||m.outputs<1||m.outputs>NEURAL_LIMITS.outputs||
    !Number.isInteger(m.hidden)||m.hidden<4||m.hidden>NEURAL_LIMITS.hidden)fail('学習モデルの構造が不正');
 const {inputs:n,outputs:o,hidden:h}=m;
 for(const [k,length] of [['w1',h*(n+1)],['w2',o*(h+1)],['inMean',n],['inScale',n],['outMean',o],['outScale',o]]){
  const v=m[k];if(!Array.isArray(v)||v.length!==length||!v.every(x=>safe(x)&&Math.abs(x)<=1e6))fail(k+'に破損または容量超過');
 }
 if(m.inScale.some(x=>x<=0)||m.outScale.some(x=>x<=0))fail('正規化尺度が不正');
 return copy(m);
}
export class WeightSpaceNetwork {
 constructor(){this.model=null;this.history=[];}
 get parameters(){return this.model?this.model.w1.length+this.model.w2.length:0;}
 snapshot(){return this.model?copy(this.model):null;}
 restore(data){try{this.model=checkModel(data);this.history=[];return true;}catch{return false;}}
 install(data){const next=checkModel(data);if(this.model){this.history.push(this.snapshot());if(this.history.length>4)this.history.shift();}this.model=next;return this.parameters;}
 rollback(){const old=this.history.pop();if(!old)return false;this.model=old;return true;}
 run(input){if(!this.model)fail('学習済みWSPがありません');return forward(this.model,input);}
}
function forward(model,input){
 const {inputs:n,outputs:o,hidden:h,w1,w2}=model;
 if(!Array.isArray(input)||input.length!==n||!input.every(x=>safe(x)&&Math.abs(x)<=NEURAL_LIMITS.maxInput))fail('推論入力の次元か値が不正');
 const x=input.map((v,i)=>(v-model.inMean[i])/model.inScale[i]),layer=new Array(h);
 for(let j=0;j<h;j++){
  let v=w1[j*(n+1)+n];for(let i=0;i<n;i++)v+=w1[j*(n+1)+i]*x[i];layer[j]=Math.tanh(v);
 }
 const result=[];for(let k=0;k<o;k++){
  let y=w2[k*(h+1)+h];for(let j=0;j<h;j++)y+=w2[k*(h+1)+j]*layer[j];
  const value=model.outMean[k]+model.outScale[k]*y;
  if(!safe(value)||Math.abs(value)>1e9)fail('推論数値が範囲外');result.push(value);
 }
 return result;
}
function fit(t){
 const n=t.inputs,o=t.outputs,h=t.hidden,r=rng(t.seed);
 const ins=meanStd(t.train,'input',n),outs=meanStd(t.train,'output',o);
 const w1=Array.from({length:h*(n+1)},()=> (r()*2-1)*Math.sqrt(2/(n+1)));
 const w2=Array.from({length:o*(h+1)},()=> (r()*2-1)*Math.sqrt(2/(h+1)));
 const model={version:1,inputs:n,outputs:o,hidden:h,w1,w2,inMean:ins.mean,inScale:ins.scale,outMean:outs.mean,outScale:outs.scale};
 const m1=new Float64Array(w1.length),v1=new Float64Array(w1.length),m2=new Float64Array(w2.length),v2=new Float64Array(w2.length);
 const xTrain=t.train.map(row=>row.input.map((v,i)=>(v-ins.mean[i])/ins.scale[i]));
 const yTrain=t.train.map(row=>row.output.map((v,i)=>(v-outs.mean[i])/outs.scale[i]));
 // Only training labels affect updates. Holdout is excluded from selection/fitting.
 for(let epoch=1;epoch<=t.epochs;epoch++){
  const d1=new Float64Array(w1.length),d2=new Float64Array(w2.length);
  for(let z=0;z<t.train.length;z++){
   const x=xTrain[z],target=yTrain[z],a=new Float64Array(h),delta=new Float64Array(o);
   for(let j=0;j<h;j++){
    const base=j*(n+1);let v=w1[base+n];for(let i=0;i<n;i++)v+=w1[base+i]*x[i];a[j]=Math.tanh(v);
   }
   for(let k=0;k<o;k++){
    const base=k*(h+1);let y=w2[base+h];for(let j=0;j<h;j++)y+=w2[base+j]*a[j];
    delta[k]=Math.max(-20,Math.min(20,y-target[k]));
    for(let j=0;j<h;j++)d2[base+j]+=delta[k]*a[j];d2[base+h]+=delta[k];
   }
   for(let j=0;j<h;j++){
    let back=0;for(let k=0;k<o;k++)back+=delta[k]*w2[k*(h+1)+j];
    back*=(1-a[j]*a[j]);const base=j*(n+1);
    for(let i=0;i<n;i++)d1[base+i]+=back*x[i];d1[base+n]+=back;
   }
  }
  const rate=.025,den=t.train.length;
  function update(weights,grad,m,v){
   const b1=.9,b2=.999;
   for(let i=0;i<weights.length;i++){
    const g=Math.max(-10,Math.min(10,grad[i]/den));
    m[i]=b1*m[i]+(1-b1)*g;v[i]=b2*v[i]+(1-b2)*g*g;
    weights[i]-=rate*(m[i]/(1-b1**epoch))/(Math.sqrt(v[i]/(1-b2**epoch))+1e-8);
    if(!safe(weights[i])||Math.abs(weights[i])>1e6)fail('学習中の重みが不正');
   }
  }
  update(w1,d1,m1,v1);update(w2,d2,m2,v2);
 }
 return model;
}
function evaluate(model,rows,tol){
 let correct=0,maxError=0,mse=0;
 const details=rows.map(row=>{
  const actual=forward(model,row.input),errors=actual.map((x,i)=>Math.abs(x-row.output[i]));
  maxError=Math.max(maxError,...errors);mse+=errors.reduce((s,x)=>s+x*x,0)/rows.length;
  const pass=errors.every(x=>x<=tol);if(pass)correct++;
  return {input:[...row.input],expected:[...row.output],actual,pass};
 });
 return {correct,total:rows.length,maxError,mse,details};
}
export function trainAndVerifyNeural(raw){
 const t=validateNeuralTask(raw),model=fit(t),training=evaluate(model,t.train,t.tolerance),validation=evaluate(model,t.holdout,t.tolerance);
 const accepted=training.correct===training.total&&validation.correct===validation.total;
 const report={accepted,status:accepted?'passed':'failed',training,validation,parameters:model.w1.length+model.w2.length,
  epochs:t.epochs,hidden:t.hidden,tolerance:t.tolerance,model:copy(model)};
 if(accepted)verified.set(report,{serialized:JSON.stringify(report.model),holdout:copy(t.holdout),tolerance:t.tolerance});
 return report;
}
export function promoteNeural(report,network){
 const token=verified.get(report);
 if(!token||!report.accepted||!(network instanceof WeightSpaceNetwork)||JSON.stringify(report.model)!==token.serialized)
  fail('未検証・改ざん済み・再利用した学習モデルは採用不可');
 const model=checkModel(report.model),validation=evaluate(model,token.holdout,token.tolerance);
 if(validation.correct!==validation.total)fail('未使用評価の再検証に不合格');
 const result=network.install(model);verified.delete(report);return result;
}
export const NEURAL_DEMO=Object.freeze({
 inputs:1,outputs:1,hidden:12,seed:2026,epochs:1200,tolerance:0.22,
 train:[-2,-1.5,-1,-0.5,0,0.5,1,1.5,2].map(x=>({input:[x],output:[x*x]})),
 holdout:[-1.8,-0.8,0.7,1.8].map(x=>({input:[x],output:[x*x]}))
});
