import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialWSP,WSP_MATERIALS,WSP_MATERIAL_LIMITS} from '../chat_web/wsp_materials.js';

function sample(seed=1,width=64,height=64){
 const data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4;
  data[p]=(x*7+y*seed)%256;
  data[p+1]=(y*13+x*seed)%256;
  data[p+2]=(x+y*9+seed*23)%256;
  data[p+3]=255;
 }
 return {width,height,data};
}
test('material expert learns entirely from local RGBA images',()=>{
 const model=new MaterialWSP();
 assert.deepEqual(model.materials(),[]);
 const a=model.learn('wood',sample(),1);
 assert.equal(a.material,'wood');assert.equal(a.examples,1);assert.equal(a.patches,16);
 assert.equal(model.has('wood'),true);
 assert.deepEqual(model.materials(),['wood']);
 assert.equal(model.report()[0].seen,1);
 assert.equal(model.snapshot().experts.wood.patches[0].length,16*16*3);
});
test('deterministic synthesis and material-conditioned shading',()=>{
 const model=new MaterialWSP();
 model.learn('wood',sample(3),77);model.learn('metal',sample(3),77);
 const params={width:64,height:64,seed:88,shape:'sphere'};
 const first=model.render('wood',params),again=model.render('wood',params),metal=model.render('metal',params);
 assert.equal(first.data.length,64*64*4);
 assert.deepEqual(first.data,again.data);
 assert.notDeepEqual(first.data,metal.data);
 assert.deepEqual(model.render('wood',{...params,shape:'plane'}).data.slice(3,8),new Uint8ClampedArray([255,...model.render('wood',{...params,shape:'plane'}).data.slice(4,8)]));
});
test('learning updates one expert, leaving other experts intact',()=>{
 const model=new MaterialWSP();
 model.learn('skin',sample(1),12);model.learn('stone',sample(2),19);
 const stone=JSON.stringify(model.snapshot().experts.stone);
 const before=JSON.stringify(model.snapshot().experts.skin);
 const result=model.learn('skin',sample(7),14);
 assert.equal(result.examples,2);
 assert.notEqual(JSON.stringify(model.snapshot().experts.skin),before);
 assert.equal(JSON.stringify(model.snapshot().experts.stone),stone);
});
test('WSP snapshots round-trip and corrupt models are rejected atomically',()=>{
 const model=new MaterialWSP();
 model.learn('glass',sample(4),2);
 const snapshot=model.snapshot(),restored=new MaterialWSP();
 assert.equal(restored.restore(snapshot),true);
 assert.deepEqual(model.render('glass',{width:64,height:64}),restored.render('glass',{width:64,height:64}));
 const bad=restored.snapshot();bad.experts.glass.patches[0][0]=Infinity;
 assert.equal(restored.restore(bad),false);
 assert.deepEqual(restored.snapshot(),snapshot);
});
test('untrained, invalid images and oversize outputs fail closed',()=>{
 const m=new MaterialWSP();const im=sample();
 assert.equal(WSP_MATERIALS.length,8);
 assert.equal(WSP_MATERIAL_LIMITS.maxOutput,384);
 assert.throws(()=>m.render('skin'),/未学習/);
 assert.throws(()=>m.learn('banana',im),/材質名/);
 assert.throws(()=>m.learn('fabric',{...im,data:new Uint8Array(8)}),/RGBA/);
 assert.throws(()=>m.learn('fabric',im,-1),/シード/);
 m.learn('fabric',im);
 assert.throws(()=>m.render('fabric',{width:999}),/生成条件/);
 assert.throws(()=>m.render('fabric',{shape:'unknown'}),/生成条件/);
 assert.throws(()=>m.render('fabric',{seed:NaN}),/生成条件/);
});
