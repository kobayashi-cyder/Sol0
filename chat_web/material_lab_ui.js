/** UI adapter for Sol0's offline, image-conditioned WSP material experiments. */
import {MaterialWSP,WSP_MATERIALS} from './wsp_materials.js';
const STORAGE_KEY='sol0_wsp_material_experts_v1';
const LABELS={skin:'肌',stone:'石',wood:'木',metal:'金属',glass:'ガラス',water:'水',fabric:'布',foliage:'植物'};
function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function options(select,choices){for(const [value,label] of choices){const option=el('option',label);option.value=value;select.append(option);}}
function button(text,fn){const b=el('button',text);b.className='btn';b.type='button';b.addEventListener('click',fn);return b;}
async function pngBytes(canvas){
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG変換に失敗')),'image/png'));
 return new Uint8Array(await blob.arrayBuffer());
}
async function decodeImage(file){
 if(!file||file.size<1||file.size>8_000_000||!['image/jpeg','image/png','image/webp'].includes(file.type))
  throw Error('PNG/JPEG/WebP画像（8MB以下）を指定してください');
 let image,release=()=>{};
 if(typeof createImageBitmap==='function'){image=await createImageBitmap(file);release=()=>image.close();}
 else{
  const url=URL.createObjectURL(file);image=new Image();
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('画像を開けません'));image.src=url;});}
  catch(e){URL.revokeObjectURL(url);throw e;}
  release=()=>URL.revokeObjectURL(url);
 }
 try{
  const max=512,scale=Math.min(1,max/Math.max(image.width,image.height));
  const w=Math.max(32,Math.round(image.width*scale)),h=Math.max(32,Math.round(image.height*scale));
  const canvas=el('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas2Dが使えません');
  ctx.drawImage(image,0,0,w,h);return ctx.getImageData(0,0,w,h);
 }finally{release();}
}
function downloadJSON(data){
 const bytes=JSON.stringify(data),blob=new Blob([bytes],{type:'application/json'}),url=URL.createObjectURL(blob),link=el('a');
 link.href=url;link.download='Sol0_WSP_material_experts.json';document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
export function mountMaterialLab(studio,root,{notify,refresh}){
 const model=new MaterialWSP();
 let persisted=true;
 try{const saved=localStorage.getItem(STORAGE_KEY);if(saved){if(saved.length>850000||!model.restore(JSON.parse(saved)))throw Error('保存モデルが不正です');}}
 catch{persisted=false;}
 const save=()=>{try{const data=JSON.stringify(model.snapshot());if(data.length>850000)throw Error('容量超過');localStorage.setItem(STORAGE_KEY,data);persisted=true;return true;}catch{persisted=false;return false;}};
 root.append(el('h3','🔬 WSP材質学習・生成核（実験版）'));
 root.append(el('p','Kimiの視覚専門処理を参考にした独立実験です。端末画像の小領域と光学統計を学習し、WSP材質記憶から新しい表面画像を合成します。写真の意味理解・実写級の保証・画像拡散ではありません。通信・外部API・既成の学習重みは使いません。'));
 const row=el('div');row.className='buttons';root.append(row);
 const material=el('select');material.setAttribute('aria-label','学習する材質');options(material,WSP_MATERIALS.map(k=>[k,LABELS[k]]));
 const shape=el('select');shape.setAttribute('aria-label','生成形状');options(shape,[['sphere','球体の表面'],['plane','平面テクスチャ']]);
 const seed=el('input');seed.type='number';seed.min='0';seed.max='4294967295';seed.value='2026';seed.style.maxWidth='125px';seed.setAttribute('aria-label','生成シード');
 row.append(material,shape,seed);
 const file=el('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';file.setAttribute('aria-label','学習用の参考画像');root.append(file);
 const controls=el('div');controls.className='buttons';root.append(controls);
 const status=el('p',model.materials().length?'学習済み：'+model.materials().map(k=>LABELS[k]).join('、'):'未学習：参考画像を読み込んで材質を選択してください。');
 status.className='muted';root.append(status);
 const preview=el('canvas');preview.width=256;preview.height=256;preview.style.cssText='display:block;max-width:100%;height:auto;max-height:256px;object-fit:contain;border-radius:12px;border:1px solid var(--line);margin:8px 0';root.append(preview);
 const report=()=>model.materials().map(k=>LABELS[k]+' '+model.model.experts[k].seen+'回').join(' / ')||'未学習';
 const busy={active:false};
 const operate=async (task)=>{
  if(busy.active||studio.busy||studio.uiBusy)return;
  busy.active=true;
  try{await task();}catch(e){status.textContent='エラー：'+e.message;}
  finally{busy.active=false;}
 };
 controls.append(button('参考画像をWSPへ学習',()=>operate(async()=>{
  const source=file.files?.[0];if(!source)throw Error('学習画像を選んでください');
  const image=await decodeImage(source);
  const answer=model.learn(material.value,image,Number(seed.value));
  const ok=save();
  status.textContent='学習済み：'+LABELS[answer.material]+'、累計'+answer.examples+'例、'+answer.patches+'領域。'+(ok?'端末へ保存済み':'端末保存失敗：重みJSONを書き出してください');
  notify?.('材質WSPを学習しました');
 })));
 controls.append(button('WSPで画像PNG生成',()=>operate(async()=>{
  const result=model.render(material.value,{width:256,height:256,seed:Number(seed.value),shape:shape.value});
  const ctx=preview.getContext('2d');ctx.putImageData(new ImageData(result.data,result.width,result.height),0,0);
  const bytes=await pngBytes(preview);
  const asset=await studio.add('wsp_'+material.value+'_'+Date.now()+'.png','image/png',bytes,'image',{source:'WSP material memory',material:material.value,shape:shape.value,seed:Number(seed.value),learnedExamples:model.model.experts[material.value].seen});
  status.textContent='生成・作品保存完了：'+asset.name+' ('+bytes.length+' bytes)。学習済み：'+report();
  notify?.('WSP表面画像を作品に追加しました');
  refresh?.();
 })));
 controls.append(button('学習重みJSON書き出し',()=>operate(async()=>{
  if(!model.materials().length)throw Error('学習モデルがありません');
  downloadJSON(model.snapshot());status.textContent='学習重みを書き出しました：'+report();
 })));
 const importFile=el('input');importFile.type='file';importFile.accept='.json,application/json';importFile.className='hidden';root.append(importFile);
 controls.append(button('学習重みを読み込み',()=>importFile.click()));
 importFile.addEventListener('change',()=>operate(async()=>{
  const source=importFile.files?.[0];importFile.value='';
  if(!source||source.size>850000)throw Error('重みファイルがありません、または容量が大きすぎます');
  const payload=JSON.parse(await source.text());
  const candidate=new MaterialWSP();if(!candidate.restore(payload))throw Error('不正なWSP重みファイルです');
  if(!model.restore(payload))throw Error('重み復元に失敗');
  const saved=save();status.textContent='重み読込完了：'+report()+'。'+(saved?'端末保存済み':'端末保存失敗');
  notify?.('材質WSPを読み込みました');
 }));
 if(!persisted)root.append(el('p','注意：保存済み材質重みを復元できませんでした。重みJSONのバックアップを使用してください。'));
}
