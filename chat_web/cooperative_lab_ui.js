/** Cooperative WSP lab. Uses existing material snapshots, offline and permission-free. */
import {MaterialWSP,WSP_MATERIALS} from './wsp_materials.js';
import {CooperativeWSP,COOP_SHAPES,COOP_LIGHTS,COOP_EXPERTS,validateCoopSpec} from './wsp_router.js';
import {generateCooperativeImage} from './wsp_cooperative_generator.js';
const MATERIAL_KEY='sol0_wsp_material_experts_v1',ROUTER_KEY='sol0_wsp_cooperative_router_v1';
const LABELS={skin:'肌',stone:'石',wood:'木',metal:'金属',glass:'ガラス',water:'水',fabric:'布',foliage:'植物'};
function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
function field(root,title,values,defaultValue){
 const lab=element('label',title),select=element('select');select.setAttribute('aria-label',title);
 for(const [v,t] of values){const option=element('option',t);option.value=String(v);select.append(option);}
 select.value=String(defaultValue);lab.append(select);lab.className='field';root.append(lab);return select;
}
function number(root,title,value,min,max,step){
 const lab=element('label',title),inp=element('input');inp.type='number';inp.min=String(min);inp.max=String(max);
 inp.step=String(step);inp.value=String(value);inp.setAttribute('aria-label',title);lab.className='field';lab.append(inp);root.append(lab);return inp;
}
function makeButton(root,label,handler){
 const btn=element('button',label);btn.type='button';btn.className='btn';btn.addEventListener('click',handler);root.append(btn);return btn;
}
function downloadJSON(data){
 const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');
 a.href=url;a.download='Sol0_WSP_cooperative_weights.json';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function loadMaterial(){
 const raw=localStorage.getItem(MATERIAL_KEY);
 if(!raw||raw.length>850000)throw Error('材質学習ラボで参考画像を学習してください');
 const model=new MaterialWSP();if(!model.restore(JSON.parse(raw)))throw Error('材質WSPの保存データが不正です');
 return model;
}
export function mountCooperativeLab(studio,root,helpers={}){
 const router=new CooperativeWSP();
 let loadWarning='';
 try{
  const saved=localStorage.getItem(ROUTER_KEY);
  if(saved&&(saved.length>15000||!router.restore(JSON.parse(saved))))throw Error('重み形式エラー');
 }catch(e){loadWarning=e.message;}
 const save=()=>{const data=JSON.stringify(router.snapshot());if(data.length>15000)throw Error('WSP重み容量超過');localStorage.setItem(ROUTER_KEY,data);};
 const h=element('h3','🧠 WSP協調生成・微調整ラボ');root.append(h);
 const explanation=element('p','既存材質学習＋形状・材質・照明・微細描画の4専門家をWSPで融合し、内部アーティファクト評価で反復します。評価点は写実度を保証せず、写真生成AIではありません。すべて端末内で処理します。');
 explanation.className='muted';root.append(explanation);
 const controls=element('div');controls.className='buttons';root.append(controls);
 const mats=WSP_MATERIALS.map(x=>[x,LABELS[x]]);
 const material=field(controls,'主材質',mats,'stone');
 const secondary=field(controls,'副材質',[['','使用しない'],...mats],'');
 const mix=number(controls,'材質混合率',.4,0,1,.05);
 const shape=field(controls,'形状',COOP_SHAPES.map(x=>[x,x]),'sphere');
 const light=field(controls,'照明',COOP_LIGHTS.map(x=>[x,x]),'studio');
 const size=field(controls,'出力サイズ',[[128,'128×128'],[256,'256×256'],[320,'320×320']],'256');
 const seed=number(controls,'シード',2026,0,4294967295,1);
 const steps=number(controls,'評価反復回数',4,1,8,1);
 const detail=number(controls,'微細表現',.65,0,1,.05);
 const coop=number(controls,'WSP協調度',.8,0,1,.05);
 const target=number(controls,'内部評価目標',.985,.3,.999,.005);
 const actions=element('div');actions.className='buttons';root.append(actions);
 const status=element('p',loadWarning?'重み復元失敗：'+loadWarning:'材質を学習した後、協調生成できます。');
 status.className='listentry';status.dataset.coopStatus='true';root.append(status);
 const preview=element('canvas');preview.width=256;preview.height=256;
 preview.style.cssText='display:block;max-width:100%;height:auto;max-height:320px;border:1px solid var(--line);border-radius:12px;margin:8px 0';
 root.append(preview);
 const score=element('p','内部評価：未実行');score.className='muted';root.append(score);
 const getSpec=()=>validateCoopSpec({width:Number(size.value),height:Number(size.value),material:material.value,
  secondaryMaterial:secondary.value||null,mix:secondary.value?Number(mix.value):0,
  shape:shape.value,light:light.value,seed:Number(seed.value),steps:Number(steps.value),
  targetQuality:Number(target.value),detailLevel:Number(detail.value),cooperation:Number(coop.value)});
 let busy=false,last=null;
 const operate=async fn=>{
  if(busy||studio.busy||studio.uiBusy)return;busy=true;
  try{await fn();}catch(e){status.textContent='協調生成エラー：'+e.message;}
  finally{busy=false;}
 };
 makeButton(actions,'協調生成 PNG',()=>operate(async()=>{
  const spec=getSpec(),memory=loadMaterial();
  const result=await generateCooperativeImage(memory,spec,router);
  preview.width=result.width;preview.height=result.height;
  preview.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);
  const blob=await new Promise((resolve,reject)=>preview.toBlob(x=>x?resolve(x):reject(Error('PNGエンコード失敗')),'image/png'));
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const asset=await studio.add('coop_'+spec.material+'_'+Date.now()+'.png','image/png',bytes,'image',{
   source:result.source,material:spec.material,secondaryMaterial:spec.secondaryMaterial,shape:spec.shape,
   light:spec.light,seed:spec.seed,stepsUsed:result.stepsUsed,internalScore:result.report.total,
   route:result.route,metric:result.report.metric});
  last={spec,result};
  status.textContent='協調生成保存：'+asset.name+' / '+result.stepsUsed+'回評価';
  score.textContent='内部評価 '+result.report.total.toFixed(4)+' / パッチ境界 '+result.report.seamScore.toFixed(4)+' / 最良反復 '+result.bestIteration;
  helpers.notify?.('WSP協調生成を作品に保存しました');
  helpers.refreshAssets?.();
 }));
 makeButton(actions,'自動微調整重みを採用',()=>operate(async()=>{
  if(!last)throw Error('先に協調生成してください');
  if(last.result.trace.length<2)throw Error('微調整を実施した結果がありません');
  if(!router.restore(last.result.tunedRouter))throw Error('採用する重みが不正です');
  save();status.textContent='WSP協調重みを保存しました（内部評価に対する微調整）';
 }));
 const expert=field(controls,'手動微調整対象',COOP_EXPERTS.map(x=>[x,x]),'lighting');
 const strength=number(controls,'目標寄与率',.9,.2,1,.05);
 makeButton(actions,'WSP重みを微調整',()=>operate(async()=>{
  const spec=getSpec(),before=router.route(spec)[expert.value];
  for(let i=0;i<10;i++)router.tune(spec,expert.value,Number(strength.value),.5);
  save();status.textContent='WSP学習済み：'+expert.value+' '+before.toFixed(3)+' → '+router.route(spec)[expert.value].toFixed(3);
 }));
 makeButton(actions,'直前の重みを戻す',()=>operate(async()=>{
  if(!router.rollback())throw Error('戻す履歴がありません');
  save();status.textContent='直前のWSP微調整を戻しました';
 }));
 makeButton(actions,'協調WSP重みJSON書き出し',()=>operate(async()=>downloadJSON(router.snapshot())));
 const imp=element('input');imp.type='file';imp.accept='.json,application/json';imp.className='hidden';root.append(imp);
 makeButton(actions,'協調WSP重みJSON読み込み',()=>imp.click());
 imp.addEventListener('change',()=>operate(async()=>{
  const f=imp.files?.[0];imp.value='';
  if(!f||f.size>15000)throw Error('JSONファイルがありません、または容量超過');
  const candidate=JSON.parse(await f.text());
  const tmp=new CooperativeWSP();if(!tmp.restore(candidate)||!router.restore(candidate))throw Error('不正なWSP重みです');
  save();status.textContent='協調WSP重みを読み込み保存しました';
 }));
}
