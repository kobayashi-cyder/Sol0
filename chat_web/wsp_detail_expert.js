/** Deterministic detail + seam blending; bounded color correction. */
const clip=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
function hash(x,y,seed){let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(seed,2246822519))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;}
export function applyDetailExpert(scene,spec){
 const w=scene.width,h=scene.height,n=w*h,albedoR=new Float32Array(scene.albedoR),
  albedoG=new Float32Array(scene.albedoG),albedoB=new Float32Array(scene.albedoB),
  detail=new Float32Array(n),confidence=new Float32Array(n),channels=['albedoR','albedoG','albedoB'];
 const amp=spec.detailLevel*(spec.material==='glass'?.008:spec.material==='metal'?.015:.028);
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const p=y*w+x;if(!scene.mask[p])continue;
  const seam=(x%12<=1||y%12<=1);
  const noise=hash(x,y,spec.seed)-.5;
  const wave=spec.material==='wood'?Math.sin(y*.12+noise*.8):spec.material==='fabric'?Math.sin(x*.9)*Math.sin(y*.9):0;
  detail[p]=clip((noise*.65+wave*.25)*amp,-.08,.08);
  if(seam){
   for(let c=0;c<3;c++){
    const val=scene[channels[c]];
    const smooth=(val[p-1]+val[p+1]+val[p-w]+val[p+w])*.25;
    [albedoR,albedoG,albedoB][c][p]=clip(.52*val[p]+.48*smooth);
   }
  }
  confidence[p]=seam?.9:.55;
 }
 return {albedoR,albedoG,albedoB,detail,confidence};
}
