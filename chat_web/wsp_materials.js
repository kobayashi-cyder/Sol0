/** Sol0 WSP material-memory generator (experimental).
 * Learns and synthesizes bounded RGB texture patches from user-supplied local images.
 * Kimi's visual-expert separation is a design reference, not copied code or weights.
 * Not a diffusion model, semantic text-to-image model, or photorealism guarantee.
 */
export const WSP_MATERIALS=Object.freeze(['skin','stone','wood','metal','glass','water','fabric','foliage']);
export const WSP_MATERIAL_LIMITS=Object.freeze({patchSize:16,patchesPerExpert:16,maxInput:1024,maxOutput:384,maxExperts:8});
const S=WSP_MATERIAL_LIMITS.patchSize,STEP=12,LEN=S*S*3;
const profiles={skin:[.58,.24],stone:[.92,.1],wood:[.72,.17],metal:[.24,.98],glass:[.07,.99],water:[.1,.84],fabric:[.93,.05],foliage:[.83,.13]};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function fail(s){throw Error('WSP材質学習：'+s);}
function rng(seed){let x=(seed>>>0)||0x6d2b79f5;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function assertMaterial(material){if(!WSP_MATERIALS.includes(material))fail('材質名が不正です');}
function checkImage(image){
 if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||
  image.width<S*2||image.height<S*2||image.width>WSP_MATERIAL_LIMITS.maxInput||image.height>WSP_MATERIAL_LIMITS.maxInput||
  !(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray)||
  image.data.length!==image.width*image.height*4)fail('RGBA画像の長さまたは寸法が不正です');
 return image;
}
function inspectModel(model){
 if(!model||model.version!==1||!model.experts||typeof model.experts!=='object'||Array.isArray(model.experts)||
    Object.keys(model.experts).length>WSP_MATERIAL_LIMITS.maxExperts)return false;
 for(const [name,d] of Object.entries(model.experts)){
  if(!WSP_MATERIALS.includes(name)||!d||!Number.isInteger(d.seen)||d.seen<1||d.seen>10000||
     !Array.isArray(d.weights)||d.weights.length!==4||!d.weights.every(v=>finite(v)&&v>=0&&v<=1)||
     !Array.isArray(d.patches)||d.patches.length<1||d.patches.length>WSP_MATERIAL_LIMITS.patchesPerExpert)return false;
  for(const p of d.patches)if(!Array.isArray(p)||p.length!==LEN||!p.every(v=>Number.isInteger(v)&&v>=0&&v<=255))return false;
 }
 return true;
}
function statistics(image){
 let total=0,mean=0,m2=0,edges=0,saturation=0;
 const {width:w,height:h,data:d}=image;
 for(let y=0;y<h-1;y+=3)for(let x=0;x<w-1;x+=3){
  const idx=(y*w+x)*4,right=idx+4,down=idx+4*w;
  const lum=(.2126*d[idx]+.7152*d[idx+1]+.0722*d[idx+2])/255;
  total++;const diff=lum-mean;mean+=diff/total;m2+=diff*(lum-mean);
  const a=(.2126*d[right]+.7152*d[right+1]+.0722*d[right+2])/255;
  const b=(.2126*d[down]+.7152*d[down+1]+.0722*d[down+2])/255;
  edges+=Math.min(1,Math.abs(lum-a)+Math.abs(lum-b));
  saturation+=(Math.max(d[idx],d[idx+1],d[idx+2])-Math.min(d[idx],d[idx+1],d[idx+2]))/255;
 }
 return [clamp(mean),clamp(Math.sqrt(m2/Math.max(total,1))),clamp(edges/total),clamp(saturation/total)];
}
function patchOf(image,x,y){
 const out=new Array(LEN);let n=0;
 for(let v=0;v<S;v++)for(let u=0;u<S;u++){
  const i=((y+v)*image.width+x+u)*4;
  out[n++]=image.data[i];out[n++]=image.data[i+1];out[n++]=image.data[i+2];
 }
 return out;
}
function validateOptions(raw){
 const width=raw.width??256,height=raw.height??256,seed=raw.seed??2026,shape=raw.shape??'sphere';
 if(!Number.isInteger(width)||width<48||width>WSP_MATERIAL_LIMITS.maxOutput||
  !Number.isInteger(height)||height<48||height>WSP_MATERIAL_LIMITS.maxOutput||
  !Number.isInteger(seed)||seed<0||seed>0xffffffff||
  !['sphere','plane'].includes(shape))fail('生成条件が不正です');
 return {width,height,seed,shape};
}
function quilt(patches,weights,width,height,seed){
 const out=new Uint8ClampedArray(width*height*4),seen=new Uint8Array(width*height),rand=rng(seed);
 for(let y=0;y<height;y+=STEP)for(let x=0;x<width;x+=STEP){
  let chosen=0,best=Infinity;
  for(let p=0;p<patches.length;p++){
   const patch=patches[p];let error=0,count=0;
   for(let dy=0;dy<S&&y+dy<height;dy++)for(let dx=0;dx<S&&x+dx<width;dx++){
    const pixel=(y+dy)*width+x+dx;
    if(!seen[pixel])continue;
    const o=pixel*4,s=(dy*S+dx)*3;
    for(let c=0;c<3;c++){const d=(out[o+c]-patch[s+c])/255;error+=d*d;}
    count++;
   }
   const score=(count?error/(count*3):0)*(.5+weights[2])+rand()*.006;
   if(score<best){best=score;chosen=p;}
  }
  const patch=patches[chosen];
  for(let dy=0;dy<S&&y+dy<height;dy++)for(let dx=0;dx<S&&x+dx<width;dx++){
   const pixel=(y+dy)*width+x+dx,o=pixel*4,s=(dy*S+dx)*3;
   const fade=seen[pixel]?.45:1;
   for(let c=0;c<3;c++)out[o+c]=Math.round(out[o+c]*(1-fade)+patch[s+c]*fade);
   out[o+3]=255;seen[pixel]=1;
  }
 }
 return out;
}
function shade(pixels,width,height,material,weights,shape){
 const [roughness,reflectance]=profiles[material],light=[-.48,-.52,.71];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;
  const nx=(x+.5-width/2)/(width*.44),ny=(y+.5-height/2)/(height*.44);
  const r2=nx*nx+ny*ny;
  if(shape==='sphere'&&r2>=1){
   const bg=17+Math.round(8*y/height);
   pixels[i]=bg;pixels[i+1]=bg+3;pixels[i+2]=bg+9;pixels[i+3]=255;
   continue;
  }
  const nz=shape==='sphere'?Math.sqrt(1-r2):1;
  const normal=shape==='sphere'?[nx,ny,nz]:[0,0,1];
  const diffuse=clamp(normal[0]*light[0]+normal[1]*light[1]+normal[2]*light[2],0,1);
  const highlight=Math.pow(Math.max(0,diffuse),Math.max(4,90*(1-roughness)))*reflectance;
  const ambient=.22+(.14+.5*weights[0])*diffuse;
  for(let c=0;c<3;c++){
   const linear=pixels[i+c]/255;
   pixels[i+c]=Math.round(255*clamp(linear*ambient+highlight*(c===2?.94:1)));
  }
 }
 return pixels;
}
/** Per-material WSP experts with learned photometric weights and bounded patch memory. */
export class MaterialWSP {
 constructor(){this.model={version:1,experts:{}};}
 materials(){return Object.keys(this.model.experts);}
 has(name){assertMaterial(name);return !!this.model.experts[name];}
 snapshot(){return JSON.parse(JSON.stringify(this.model));}
 restore(raw){if(!inspectModel(raw))return false;this.model=JSON.parse(JSON.stringify(raw));return true;}
 learn(material,input,seed=2026){
  assertMaterial(material);const image=checkImage(input);
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)fail('シードが不正です');
  const old=this.model.experts[material],rand=rng(seed^image.width^image.height);
  const patches=old?old.patches.slice(-8):[];
  for(let i=patches.length;i<WSP_MATERIAL_LIMITS.patchesPerExpert;i++){
   const x=Math.floor(rand()*(image.width-S+1)),y=Math.floor(rand()*(image.height-S+1));
   patches.push(patchOf(image,x,y));
  }
  const observed=statistics(image);
  const weights=old?observed.map((v,i)=>clamp((old.weights[i]*Math.min(7,old.seen)+v)/(Math.min(7,old.seen)+1))):observed;
  const next=this.snapshot();
  next.experts[material]={seen:Math.min(10000,(old?.seen??0)+1),weights,patches};
  if(!inspectModel(next))fail('学習後モデルが不正です');
  this.model=next;
  return {material,examples:this.model.experts[material].seen,patches:patches.length,weights};
 }
 render(material,raw={}){
  assertMaterial(material);const expert=this.model.experts[material];
  if(!expert)fail('未学習の材質です。参考画像を取り込んでください');
  const {width,height,seed,shape}=validateOptions(raw);
  const pixels=quilt(expert.patches,expert.weights,width,height,seed);
  return {width,height,data:shade(pixels,width,height,material,expert.weights,shape),material,shape};
 }
 report(){
  return this.materials().map(name=>({name,seen:this.model.experts[name].seen,weights:[...this.model.experts[name].weights]}));
 }
}
