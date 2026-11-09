/** Deterministic analytic geometry expert for a bounded surface scene. */
export function applyShapeExpert(scene,spec){
 const {width:w,height:h}=scene,n=w*h;
 const mask=new Uint8Array(n),depth=new Float32Array(n),normalX=new Float32Array(n),
  normalY=new Float32Array(n),normalZ=new Float32Array(n),occlusion=new Float32Array(n),confidence=new Float32Array(n);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=y*w+x,u=((x+.5)/w-.5)*2.28,v=((y+.5)/h-.5)*2.28;
  let nx=0,ny=0,nz=1,d=.5,inside=true;
  if(spec.shape==='sphere'){
   const rr=u*u+v*v;inside=rr<=1;
   if(inside){nx=u;ny=v;nz=Math.sqrt(Math.max(0,1-rr));d=.1+.8*nz;}
  }else if(spec.shape==='cube'){
   inside=Math.abs(u)<.82&&Math.abs(v)<.82;
   if(inside){
    if(v<-.34+u*.15){nx=.07;ny=-.75;nz=.65;d=.56;}
    else if(u>.35){nx=.73;ny=.13;nz=.67;d=.35;}
    else{nx=0;ny=0;nz=1;d=.65;}
   }
  }else if(spec.shape==='tile'){
   const ax=Math.abs(u),ay=Math.abs(v),r=.16;
   const dx=Math.max(0,ax-(.93-r)),dy=Math.max(0,ay-(.93-r));
   inside=dx*dx+dy*dy<=r*r&&ax<.93&&ay<.93;
   if(inside){const edge=Math.max(ax,ay);nz=.7+.3*(1-Math.pow(edge/.93,8));nx=u*.08;ny=v*.08;d=.42+nz*.2;}
  }
  if(inside){
   mask[p]=1;normalX[p]=nx;normalY[p]=ny;normalZ[p]=nz;
   depth[p]=d;occlusion[p]=spec.shape==='sphere'?.86+.14*nz:.95;
  }
  confidence[p]=1;
 }
 return {mask,depth,normalX,normalY,normalZ,occlusion,confidence};
}
