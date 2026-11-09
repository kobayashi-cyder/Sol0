/** Explicit internal artifact proxy metrics. NOT photographic realism evaluation. */
const clip=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const TRAITS={skin:[.64,.02],stone:[.91,.01],wood:[.71,.01],metal:[.26,.93],glass:[.09,.01],
 water:[.11,.01],fabric:[.88,.01],foliage:[.78,.01]};
export function evaluateScene(scene,spec){
 const {width:w,height:h}=scene,n=w*h,refineMask=new Uint8Array(n);
 let shapes=0,lights=0,materials=0,artifacts=0,seams=0,inside=0,seamCount=0;
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const p=y*w+x;if(!scene.mask[p])continue;inside++;
  const norm=Math.hypot(scene.normalX[p],scene.normalY[p],scene.normalZ[p]);
  const shapeError=Math.min(1,Math.abs(norm-1));shapes+=shapeError;
  const rough=scene.roughness[p],metal=scene.metallic[p];
  const expected=TRAITS[spec.material],matError=.5*(Math.abs(rough-expected[0])+Math.abs(metal-expected[1]));
  materials+=Math.min(1,matError);
  const lightError=Math.max(0,scene.diffuse[p]+scene.specular[p]-1)+Math.max(0,-scene.diffuse[p]);
  lights+=Math.min(1,lightError);
  const albedo=(scene.albedoR[p]+scene.albedoG[p]+scene.albedoB[p])/3;
  const extreme=albedo<.012||albedo>.985?1:0;artifacts+=extreme;
  let anomaly=0;
  if((x%12===0||y%12===0)&&scene.mask[p-1]&&scene.mask[p+1]&&scene.mask[p-w]&&scene.mask[p+w]){
   for(const k of ['albedoR','albedoG','albedoB']){
    const v=scene[k][p],near=(scene[k][p-1]+scene[k][p+1]+scene[k][p-w]+scene[k][p+w])*.25;
    anomaly+=Math.max(0,Math.abs(v-near)-.08)/3;
   }
   seams+=Math.min(1,anomaly*2.5);seamCount++;
  }
  if(shapeError>.06||matError>.14||lightError>.09||anomaly>.06||extreme)refineMask[p]=1;
 }
 const count=Math.max(inside,1);
 const report={shapeScore:clip(1-shapes/count),materialScore:clip(1-materials/count),
  lightingScore:clip(1-lights/count),seamScore:clip(1-seams/Math.max(seamCount,1)),
  artifactScore:clip(1-artifacts/count),refineMask};
 report.total=clip(.19*report.shapeScore+.2*report.materialScore+.2*report.lightingScore+
  .26*report.seamScore+.15*report.artifactScore);
 report.flagged=refineMask.reduce((sum,v)=>sum+v,0);
 report.metric='internal-artifact-proxy';
 return report;
}
