import test from 'node:test';
import assert from 'node:assert/strict';
import {createScene,cloneScene,validateScene,mergeProposal,renderSceneToRGBA} from '../chat_web/wsp_scene.js';
import {validateCoopSpec,CooperativeWSP} from '../chat_web/wsp_router.js';
import {applyShapeExpert} from '../chat_web/wsp_shape_expert.js';
import {applyLightingExpert} from '../chat_web/wsp_lighting_expert.js';
import {MaterialWSP} from '../chat_web/wsp_materials.js';
import {generateCooperativeImage} from '../chat_web/wsp_cooperative_generator.js';

function sample(seed=4){
 const width=48,height=48,data=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=(y*width+x)*4;
  data[p]=(x*5+seed*y)%256;data[p+1]=(y*7+seed*x)%256;
  data[p+2]=(x*2+y*3+seed)%256;data[p+3]=255;
 }
 return {width,height,data};
}
function trained(){
 const model=new MaterialWSP();
 model.learn('stone',sample(4),4);model.learn('metal',sample(8),8);
 return model;
}
test('scene fields, isolated clone and all-or-nothing proposal validation',()=>{
 const sc=createScene(64,64),copy=cloneScene(sc);
 assert.ok(validateScene(sc));copy.depth[0]=.8;assert.notEqual(sc.depth[0],copy.depth[0]);
 assert.throws(()=>createScene(999,64));
 const proposal=applyShapeExpert(sc,validateCoopSpec({width:64,height:64}));
 assert.equal(sc.mask[0],1);
 mergeProposal(sc,proposal,1);assert.equal(sc.mask[0],0);
 assert.equal(sc.mask[32*64+32],1);
 const rgba=renderSceneToRGBA(sc);assert.equal(rgba.length,64*64*4);
 const invalid={...proposal,confidence:new Float32Array(64*64)};
 invalid.confidence[10]=NaN;
 const before=cloneScene(sc);assert.throws(()=>mergeProposal(sc,invalid,1));
 assert.deepEqual(sc.mask,before.mask);assert.deepEqual(sc.depth,before.depth);
});
test('WSP router learns, serializes and preserves multi-step rollback',()=>{
 const spec=validateCoopSpec({width:64,height:64,material:'metal',light:'side'});
 const router=new CooperativeWSP(),before=router.route(spec).lighting;
 for(let i=0;i<5;i++)router.tune(spec,'lighting',.98,.5);
 assert.ok(router.route(spec).lighting>before);
 const clone=new CooperativeWSP();assert.ok(clone.restore(router.snapshot()));
 assert.deepEqual(clone.route(spec),router.route(spec));
 assert.equal(clone.restore({...router.snapshot(),weights:[[Infinity]]}),false);
 assert.ok(router.rollback());assert.ok(router.rollback());
 assert.throws(()=>router.tune(spec,'lighting',100));
 assert.throws(()=>validateCoopSpec({width:999}));
 assert.throws(()=>validateCoopSpec({secondaryMaterial:null,mix:.4}));
});
test('four-expert generator is deterministic and exposes audit-only metrics',async()=>{
 const memory=trained(),spec={width:64,height:64,seed:9,material:'stone',steps:4,targetQuality:.999,shape:'sphere',light:'studio'};
 const first=await generateCooperativeImage(memory,spec),again=await generateCooperativeImage(memory,spec);
 assert.deepEqual(first.data,again.data);
 assert.deepEqual(first.trace,again.trace);
 assert.equal(first.width,64);assert.equal(first.data.length,64*64*4);
 assert.ok(first.trace.length>=1&&first.trace.length<=4);
 assert.ok(first.report.total>=first.trace[0].total-1e-8);
 assert.equal(first.report.metric,'internal-artifact-proxy');
 assert.ok(first.report.total>=0&&first.report.total<=1);
 assert.ok(first.tunedRouter.version===1);
});
test('light, geometry and learned materials independently affect output',async()=>{
 const memory=trained(),base={width:64,height:64,material:'stone',seed:12,steps:1};
 const a=await generateCooperativeImage(memory,{...base,shape:'sphere',light:'soft'});
 const b=await generateCooperativeImage(memory,{...base,shape:'cube',light:'soft'});
 const c=await generateCooperativeImage(memory,{...base,shape:'sphere',light:'hard'});
 const d=await generateCooperativeImage(memory,{...base,material:'metal',shape:'sphere',light:'soft'});
 assert.notDeepEqual(a.data,b.data);assert.notDeepEqual(a.data,c.data);assert.notDeepEqual(a.data,d.data);
});
test('learned double-material input, validation and bounded WSP operation',async()=>{
 const memory=trained();
 const pair=await generateCooperativeImage(memory,{width:64,height:64,material:'stone',secondaryMaterial:'metal',mix:.5,steps:3,seed:8});
 assert.equal(pair.data.length,64*64*4);
 assert.equal(pair.trace.length,3);
 await assert.rejects(()=>generateCooperativeImage(memory,{width:64,height:64,material:'glass'}),/学習/);
 await assert.rejects(()=>generateCooperativeImage(memory,{width:64,height:64,steps:99}),/outside bounds/);
 const texture=memory.sampleTexture('stone',{width:64,height:64,seed:11});
 assert.equal(texture.data.length,64*64*4);
});
