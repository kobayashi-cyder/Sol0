/** Offline cooperative WSP image engine with bounded critic-guided fine tuning.
 * Objective reports are artifact proxies, never claims of human realism.
 */
import {createScene,mergeProposal,renderSceneToRGBA} from './wsp_scene.js';
import {validateCoopSpec,CooperativeWSP} from './wsp_router.js';
import {applyShapeExpert} from './wsp_shape_expert.js';
import {applyMaterialExpert} from './wsp_material_expert.js';
import {applyLightingExpert} from './wsp_lighting_expert.js';
import {applyDetailExpert} from './wsp_detail_expert.js';
import {evaluateScene} from './wsp_critic.js';
export async function generateCooperativeImage(materialWsp,rawSpec={},router=new CooperativeWSP()){
 const spec=validateCoopSpec(rawSpec);
 if(!materialWsp||typeof materialWsp.has!=='function'||!materialWsp.has(spec.material)||
    (spec.secondaryMaterial&&!materialWsp.has(spec.secondaryMaterial)))
   throw Error('WSP協調生成：材質の学習が必要です');
 if(!(router instanceof CooperativeWSP))throw Error('WSP協調生成：routerが不正です');
 const working=new CooperativeWSP();if(!working.restore(router.snapshot()))throw Error('WSP協調生成：WSP重みが不正です');
 const trace=[];let best=null,previousMask=null;
 for(let step=0;step<spec.steps;step++){
  const route=working.route(spec),scene=createScene(spec.width,spec.height);
  const amount=name=>Math.min(1,route[name]+(1-route[name])*spec.cooperation*.25);
  mergeProposal(scene,applyShapeExpert(scene,spec),amount('shape'));
  mergeProposal(scene,applyMaterialExpert(scene,spec,materialWsp),amount('material'));
  mergeProposal(scene,applyLightingExpert(scene,spec),amount('lighting'));
  // Preserve complete surfaces; local deficit mask only guides detail refinements.
  mergeProposal(scene,applyDetailExpert(scene,spec),amount('detail'),previousMask);
  const report=evaluateScene(scene,spec);
  trace.push({iteration:step+1,total:report.total,shapeScore:report.shapeScore,
   materialScore:report.materialScore,lightingScore:report.lightingScore,
   seamScore:report.seamScore,artifactScore:report.artifactScore,flagged:report.flagged});
  if(!best||report.total>best.report.total+1e-8){
   best={data:renderSceneToRGBA(scene),report,route:{...route},wsp:working.snapshot(),iteration:step+1};
  }
  if(report.total>=spec.targetQuality)break;
  previousMask=report.refineMask;
  working.tuneFromCritic(spec,report);
  // Permit UI updates without nondeterministic computation order.
  if(step%2===1)await Promise.resolve();
 }
 const {refineMask,...compactReport}=best.report;
 return {width:spec.width,height:spec.height,data:best.data,report:compactReport,
  trace,route:best.route,stepsUsed:trace.length,bestIteration:best.iteration,
  tunedRouter:best.wsp,source:'WSP-cooperative-experimental'};
}
