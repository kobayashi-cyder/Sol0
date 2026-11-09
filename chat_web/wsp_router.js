/** Small trainable WSP expert router; weights are local and auditable. */
export const COOP_SHAPES=Object.freeze(['sphere','cube','plane','tile']);
export const COOP_LIGHTS=Object.freeze(['soft','hard','side','top','studio']);
export const COOP_EXPERTS=Object.freeze(['shape','material','lighting','detail']);
export const ROUTER_FEATURES=9;
const clip=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export function validateCoopSpec(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('WSP cooperation spec must be object');
 const spec={width:input.width??256,height:input.height??256,seed:input.seed??2026,shape:input.shape??'sphere',
  material:input.material??'stone',secondaryMaterial:input.secondaryMaterial??null,mix:input.mix??0,
  light:input.light??'studio',steps:input.steps??4,targetQuality:input.targetQuality??.98,
  detailLevel:input.detailLevel??.6,cooperation:input.cooperation??.8};
 if(!Number.isInteger(spec.width)||!Number.isInteger(spec.height)||spec.width<64||spec.height<64||spec.width>384||spec.height>384||
   !Number.isInteger(spec.seed)||spec.seed<0||spec.seed>0xffffffff||!COOP_SHAPES.includes(spec.shape)||
   !COOP_LIGHTS.includes(spec.light)||!Number.isInteger(spec.steps)||spec.steps<1||spec.steps>8||
   ![spec.targetQuality,spec.detailLevel,spec.cooperation,spec.mix].every(Number.isFinite)||
   spec.targetQuality<.3||spec.targetQuality>.999||spec.detailLevel<0||spec.detailLevel>1||
   spec.cooperation<0||spec.cooperation>1||spec.mix<0||spec.mix>1)throw Error('WSP cooperation spec outside bounds');
 const materials=['skin','stone','wood','metal','glass','water','fabric','foliage'];
 if(!materials.includes(spec.material)||(spec.secondaryMaterial!==null&&!materials.includes(spec.secondaryMaterial)))throw Error('WSP material invalid');
 if(spec.secondaryMaterial===null&&spec.mix!==0)throw Error('secondary material required for mixture');
 return spec;
}
export function features(spec){
 const s=validateCoopSpec(spec);
 return [1,s.shape==='sphere'?1:0,s.shape==='cube'?1:0,
  s.material==='metal'?1:0,s.material==='glass'?1:0,s.material==='water'?1:0,
  ['side','hard'].includes(s.light)?1:0,s.detailLevel,s.cooperation];
}
const sigmoid=z=>z>=0?1/(1+Math.exp(-z)):Math.exp(z)/(1+Math.exp(z));
function modelValid(x){
 return x&&x.version===1&&Array.isArray(x.bias)&&x.bias.length===4&&
  Array.isArray(x.weights)&&x.weights.length===4&&
  [...x.bias,...x.weights.flat()].every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=8)&&
  x.weights.every(row=>Array.isArray(row)&&row.length===ROUTER_FEATURES);
}
export class CooperativeWSP {
 constructor(){this.bias=[1.1,1,.9,.45];this.weights=Array.from({length:4},()=>Array(ROUTER_FEATURES).fill(0));this.history=[];}
 snapshot(){return {version:1,bias:[...this.bias],weights:this.weights.map(row=>[...row])};}
 restore(model){if(!modelValid(model))return false;this.bias=[...model.bias];this.weights=model.weights.map(row=>[...row]);this.history=[];return true;}
 rollback(){const old=this.history.pop();return old?this.restore(old):false;}
 route(raw){
  const x=features(raw),out={};
  COOP_EXPERTS.forEach((name,k)=>{
   const z=this.bias[k]+this.weights[k].reduce((v,w,i)=>v+w*x[i],0);
   out[name]=.2+.8*sigmoid(z);
  });
  return out;
 }
 tune(spec,expert,target,rate=.14){
  const k=COOP_EXPERTS.indexOf(expert),x=features(spec);
  if(k<0||!Number.isFinite(target)||target<.2||target>1||!Number.isFinite(rate)||rate<=0||rate>.5)throw Error('WSP tuning bounds violated');
  this.history.push(this.snapshot());if(this.history.length>16)this.history.shift();
  const z=this.bias[k]+this.weights[k].reduce((v,w,i)=>v+w*x[i],0);
  const y=sigmoid(z),pred=.2+.8*y;
  const gradient=(pred-target)*.8*y*(1-y);
  this.bias[k]=clip(this.bias[k]-rate*gradient,-8,8);
  for(let i=0;i<x.length;i++)this.weights[k][i]=clip(this.weights[k][i]-rate*gradient*x[i],-8,8);
  return {before:pred,after:this.route(spec)[expert]};
 }
 tuneFromCritic(spec,report){
  if(!report||!['shapeScore','materialScore','lightingScore','seamScore'].every(k=>Number.isFinite(report[k])))throw Error('Critic report invalid');
  const scores=[report.shapeScore,report.materialScore,report.lightingScore,report.seamScore];
  const before=this.route(spec);
  COOP_EXPERTS.forEach((name,k)=>{
   const desired=clip(before[name]+.24*(1-clip(scores[k])),.2,1);
   this.tune(spec,name,desired,.36);
  });
  return this.route(spec);
 }
}
export function routeExperts(spec,router=new CooperativeWSP()){return router.route(spec);}
