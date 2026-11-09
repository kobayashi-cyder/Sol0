/** Learned RGB patch memory projected into a shared WSP surface scene. */
const DEFAULTS={skin:[.64,.02,.26],stone:[.91,.01,.01],wood:[.71,.01,.02],metal:[.26,.93,.01],
 glass:[.09,.01,.92],water:[.11,.01,.78],fabric:[.88,.01,.03],foliage:[.78,.01,.05]};
const clip=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
function surface(memory,material,width,height,seed){
 if(!memory||!memory.has(material)||typeof memory.sampleTexture!=='function')throw Error('WSP material not learned: '+material);
 return {pixels:memory.sampleTexture(material,{width,height,seed}).data,
  stats:memory.model.experts[material].weights,traits:DEFAULTS[material]};
}
export function applyMaterialExpert(scene,spec,memory){
 const w=scene.width,h=scene.height,n=w*h,main=surface(memory,spec.material,w,h,spec.seed);
 const second=spec.secondaryMaterial?surface(memory,spec.secondaryMaterial,w,h,spec.seed^0x314159):null;
 const albedoR=new Float32Array(n),albedoG=new Float32Array(n),albedoB=new Float32Array(n),
  roughness=new Float32Array(n),metallic=new Float32Array(n),translucency=new Float32Array(n),confidence=new Float32Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,i=p*4;
  // Smooth spatial transition for mixed materials rather than a global average.
  const mix=second?clip(spec.mix*(.48+.52*x/Math.max(1,w-1))*2):0;
  const sample=(c)=>clip((main.pixels[i+c]*(1-mix)+((second?.pixels[i+c])??0)*mix)/255);
  albedoR[p]=sample(0);albedoG[p]=sample(1);albedoB[p]=sample(2);
  const roughMain=clip(main.traits[0]+(main.stats[2]-.4)*.13);
  roughness[p]=clip(roughMain*(1-mix)+(second?clip(second.traits[0]+(second.stats[2]-.4)*.13)*mix:0));
  metallic[p]=clip(main.traits[1]*(1-mix)+(second?second.traits[1]*mix:0));
  translucency[p]=clip(main.traits[2]*(1-mix)+(second?second.traits[2]*mix:0));
  confidence[p]=scene.mask[p]?.96:0;
 }
 return {albedoR,albedoG,albedoB,roughness,metallic,translucency,confidence};
}
