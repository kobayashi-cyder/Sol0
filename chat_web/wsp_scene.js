/** Bounded common scene for cooperative WSP renderers. No pretrained model. */
export const SCENE_LIMITS=Object.freeze({min:64,max:384,maxPixels:384*384});
export const SCENE_FIELDS=Object.freeze(['depth','normalX','normalY','normalZ','albedoR','albedoG','albedoB','roughness','metallic','translucency','occlusion','diffuse','specular','shadow','detail','confidence']);
const between=(x,min=0,max=1)=>Math.min(max,Math.max(min,x));
export function createScene(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<SCENE_LIMITS.min||height<SCENE_LIMITS.min||width>SCENE_LIMITS.max||height>SCENE_LIMITS.max||width*height>SCENE_LIMITS.maxPixels)throw Error('WSP scene size invalid');
 const count=width*height,scene={version:1,width,height,mask:new Uint8Array(count)};
 for(const key of SCENE_FIELDS)scene[key]=new Float32Array(count);
 scene.normalZ.fill(1);scene.roughness.fill(.65);scene.occlusion.fill(1);
 scene.diffuse.fill(.65);scene.confidence.fill(.5);scene.mask.fill(1);
 return scene;
}
export function validateScene(scene){
 if(!scene||scene.version!==1||!Number.isInteger(scene.width)||!Number.isInteger(scene.height)||scene.width<SCENE_LIMITS.min||scene.height<SCENE_LIMITS.min||scene.width>SCENE_LIMITS.max||scene.height>SCENE_LIMITS.max)return false;
 const n=scene.width*scene.height;
 return scene.mask instanceof Uint8Array&&scene.mask.length===n&&
  SCENE_FIELDS.every(k=>scene[k] instanceof Float32Array&&scene[k].length===n);
}
export function cloneScene(scene){
 if(!validateScene(scene))throw Error('WSP scene invalid');
 const result=createScene(scene.width,scene.height);result.mask.set(scene.mask);
 for(const k of SCENE_FIELDS)result[k].set(scene[k]);
 return result;
}
export function clearScene(scene){
 if(!validateScene(scene))throw Error('WSP scene invalid');
 const empty=createScene(scene.width,scene.height);scene.mask.set(empty.mask);
 for(const k of SCENE_FIELDS)scene[k].set(empty[k]);return scene;
}
export function mergeProposal(scene,proposal,strength=1,refineMask=null){
 if(!validateScene(scene)||!proposal||typeof proposal!=='object'||!Number.isFinite(strength)||strength<0||strength>1)throw Error('WSP proposal invalid');
 const n=scene.width*scene.height,confidence=proposal.confidence;
 if(!(confidence instanceof Float32Array)||confidence.length!==n)throw Error('WSP proposal confidence invalid');
 if(refineMask!==null&&(!(refineMask instanceof Uint8Array)||refineMask.length!==n))throw Error('WSP refinement mask invalid');
 if(proposal.mask!==undefined&&(!(proposal.mask instanceof Uint8Array)||proposal.mask.length!==n))throw Error('WSP mask invalid');
 const entries=SCENE_FIELDS.filter(k=>k!=='confidence'&&proposal[k]!==undefined);
 for(const key of entries)if(!(proposal[key] instanceof Float32Array)||proposal[key].length!==n)throw Error('WSP proposal channel invalid: '+key);
 // Validation before any state mutation, not a partial update on malformed values.
 for(let p=0;p<n;p++){
  if(!Number.isFinite(confidence[p])||confidence[p]<0||confidence[p]>1)throw Error('WSP confidence outside bounds');
  for(const key of entries)if(!Number.isFinite(proposal[key][p]))throw Error('WSP proposal nonfinite');
 }
 if(proposal.mask!==undefined)scene.mask.set(proposal.mask);
 for(let p=0;p<n;p++){
  const alpha=strength*confidence[p]*(refineMask?(refineMask[p]?.92:.18):1);
  for(const key of entries){
   const b=key==='detail'||key.startsWith('normal')?-1:0;
   const a=scene[key][p],v=proposal[key][p];
   scene[key][p]=between(a+(v-a)*alpha,b,key==='detail'?1:1);
  }
  scene.confidence[p]=between(scene.confidence[p]*(1-alpha)+confidence[p]*alpha);
 }
 if(entries.some(k=>k.startsWith('normal'))){
  for(let p=0;p<n;p++)if(scene.mask[p]){
   const x=scene.normalX[p],y=scene.normalY[p],z=scene.normalZ[p],norm=Math.hypot(x,y,z)||1;
   scene.normalX[p]=x/norm;scene.normalY[p]=y/norm;scene.normalZ[p]=z/norm;
  }
 }
 return scene;
}
export function renderSceneToRGBA(scene){
 if(!validateScene(scene))throw Error('WSP scene invalid');
 const n=scene.width*scene.height,bytes=new Uint8ClampedArray(n*4);
 for(let p=0;p<n;p++){
  const i=p*4;
  if(!scene.mask[p]){bytes[i]=17;bytes[i+1]=21;bytes[i+2]=31;bytes[i+3]=255;continue;}
  const dif=between(scene.diffuse[p]),spec=between(scene.specular[p]),sh=between(scene.shadow[p]),occ=between(scene.occlusion[p]);
  for(const [c,k] of ['albedoR','albedoG','albedoB'].entries()){
   const linear=between(scene[k][p])*dif*(1-sh)*occ+spec+scene.detail[p];
   const mapped=between(linear/(.88+.12*linear));
   bytes[i+c]=Math.round(255*Math.pow(mapped,1/2.2));
  }
  bytes[i+3]=255;
 }
 return bytes;
}
