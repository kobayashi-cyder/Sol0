/** Analytic lighting expert; physically inspired, not learned scene understanding. */
const clip=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const PRESETS={soft:[-.37,-.34,.86,.68,.3],hard:[-.44,-.55,.71,.97,.12],
 side:[-.83,-.1,.55,.85,.17],top:[-.12,-.87,.48,.78,.2],studio:[-.42,-.48,.76,.82,.31]};
export function applyLightingExpert(scene,spec){
 const n=scene.width*scene.height,light=PRESETS[spec.light];
 if(!light)throw Error('WSP light preset invalid');
 const len=Math.hypot(light[0],light[1],light[2]),L=light.slice(0,3).map(v=>v/len);
 const diffuse=new Float32Array(n),specular=new Float32Array(n),shadow=new Float32Array(n),confidence=new Float32Array(n);
 for(let p=0;p<n;p++)if(scene.mask[p]){
  const nx=scene.normalX[p],ny=scene.normalY[p],nz=scene.normalZ[p];
  const ndl=clip(nx*L[0]+ny*L[1]+nz*L[2]);
  const rough=clip(scene.roughness[p]),metal=clip(scene.metallic[p]),trans=clip(scene.translucency[p]);
  const ambient=.18+light[4],strength=light[3];
  diffuse[p]=clip(ambient+strength*ndl*(1-.3*metal));
  const hx=L[0],hy=L[1],hz=L[2]+1,hl=Math.hypot(hx,hy,hz);
  const ndh=clip((nx*hx+ny*hy+nz*hz)/hl);
  const exponent=4+100*Math.pow(1-rough,2);
  specular[p]=clip(Math.pow(ndh,exponent)*(0.08+0.35*metal+.2*trans)*(1+.12*(1-rough)));
  shadow[p]=clip((1-ndl)*(.16+.08*(1-spec.cooperation)));
  confidence[p]=.94;
 }
 return {diffuse,specular,shadow,confidence};
}
