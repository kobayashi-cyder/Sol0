/** Unified offline media workspace for Sol-Zero. No external AI/services. */
import {MEDIA_LIMITS,validateMediaSpec,renderMediaScene,audioSpec,synthSamples,wavBytes,rgbaToIndex,gifBytes,zipBytes,unzipStored,MediaWSP} from './media_studio.js';
const STORE='solzero_studio_v012_recipe',DB_NAME='solzero_media_v012';
function element(tag,txt){const x=document.createElement(tag);if(txt!==undefined)x.textContent=txt;return x;}
function mimeFor(name){const ext=name.toLowerCase().split('.').pop();return ({png:'image/png',gif:'image/gif',jpg:'image/jpeg',jpeg:'image/jpeg',wav:'audio/wav',mp3:'audio/mpeg',webm:'video/webm',mp4:'video/mp4'})[ext]||null;}
function fileDownload(data,name,type){const blob=new Blob([data],{type}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10_000);}
function makeCanvas(w,h){const c=element('canvas');c.width=w;c.height=h;return c;}
function toPng(canvas){return new Promise((resolve,reject)=>canvas.toBlob(async blob=>{if(!blob)return reject(Error('PNG変換に失敗'));resolve(new Uint8Array(await blob.arrayBuffer()));},'image/png'));}
async function studioDB(){if(typeof indexedDB==='undefined')return null;return new Promise((res)=>{let r;try{r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('assets'))r.result.createObjectStore('assets',{keyPath:'id'});};r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null);}catch{res(null);}});}
async function dbOp(op,value){
 const db=await studioDB();if(!db)return null;
 return new Promise(resolve=>{
  let done=false,result=null;
  const finish=v=>{if(done)return;done=true;db.close();resolve(v);};
  try{
   const tx=db.transaction('assets',op==='getAll'?'readonly':'readwrite'),s=tx.objectStore('assets');
   const req=op==='getAll'?s.getAll():op==='put'?s.put(value):op==='clear'?s.clear():s.delete(value);
   req.onsuccess=()=>{result=req.result??true;};
   tx.oncomplete=()=>finish(result);
   tx.onabort=()=>finish(null);
  }catch{finish(null);}
 });
}
// IndexedDB transactions either commit all restored assets or keep the old set.
async function replaceAssetsTransaction(assets){
 const db=await studioDB();if(!db)return null;
 return new Promise(resolve=>{
  let done=false;
  const finish=ok=>{if(done)return;done=true;db.close();resolve(ok);};
  try{
   const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets');
   store.clear();for(const asset of assets)store.put(asset);
   tx.oncomplete=()=>finish(true);
   tx.onabort=()=>finish(false);
  }catch{finish(false);}
 });
}
export class MediaStudio {
 constructor(){this.assets=[];this.loaded=false;this.loadingPromise=null;this.storageState='unknown';this.recipeSaved=true;this.previewUrls=new Set();this.busy=false;this.uiBusy=false;this.wsp=new MediaWSP();this.project={name:'Sol-Zero作品',prompt:'夕焼けの海に浮かぶ星',seed:2026,theme:'auto',width:512,height:288,frames:24,fps:8,kind:'waves',text:'こんにちは'};
  try{
   const serialized=localStorage.getItem(STORE);
   if(serialized&&serialized.length<=4096){
    const raw=JSON.parse(serialized);
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
     const candidate={...this.project};
     for(const key of ['name','prompt','seed','theme','width','height','frames','fps','kind','text'])
      if(Object.hasOwn(raw,key))candidate[key]=raw[key];
     if(typeof candidate.name!=='string'||candidate.name.length>60||
        typeof candidate.prompt!=='string'||candidate.prompt.length>180||
        typeof candidate.text!=='string'||candidate.text.length>200||
        !['seed','width','height','frames','fps'].every(key=>Number.isInteger(candidate[key])))
      throw Error('保存済み作品設定が不正');
     validateMediaSpec({...candidate,theme:candidate.theme==='auto'?undefined:candidate.theme});
     audioSpec({kind:candidate.kind,seconds:candidate.frames/candidate.fps,seed:candidate.seed,text:candidate.text});
     if(raw.wsp!==undefined&&!this.wsp.restore(raw.wsp))throw Error('保存済み重みが不正');
     this.project=candidate;
    }
   }
  }catch{this.wsp=new MediaWSP();}
 }
 async ensureLoaded(){
  if(this.loaded)return;
  if(!this.loadingPromise){
   this.loadingPromise=(async()=>{
    const rows=await dbOp('getAll');
    this.storageState=Array.isArray(rows)?'saved':'session';
    if(Array.isArray(rows)){
     for(const asset of rows){
      if(asset?.id&&asset?.name&&asset?.bytes instanceof Uint8Array&&
         asset.bytes.length<=MEDIA_LIMITS.projectBytes&&this.assets.length<MEDIA_LIMITS.assets)
       this.assets.push(asset);
     }
    }
    this.loaded=true;
   })().finally(()=>{this.loadingPromise=null;});
  }
  return this.loadingPromise;
 }
 saveRecipe(){try{localStorage.setItem(STORE,JSON.stringify({...this.project,wsp:this.wsp.snapshot()}));this.recipeSaved=true;return true;}catch{this.recipeSaved=false;return false;}}
 buildSpec(p=this.project){const theme=p.theme==='auto'?undefined:p.theme;const result=validateMediaSpec({prompt:p.prompt,seed:Number(p.seed),width:Number(p.width),height:Number(p.height),frames:Number(p.frames),fps:Number(p.fps),theme});return validateMediaSpec({...result,controls:this.wsp.controls(result.theme)});}
 async checkSessionRecovery(){
  // If a browser temporarily hid a previously existing DB during startup, never
  // overwrite that persisted project with a partial in-memory workspace.
  if(this.storageState!=='session')return;
  const existing=await dbOp('getAll');
  if(!Array.isArray(existing))return;
  const inMemoryIds=new Set(this.assets.map(a=>a.id));
  if(existing.some(asset=>!inMemoryIds.has(asset.id)))
   throw Error('保存領域に別の素材があります。作品ZIPを退避してから画面を再読み込みしてください');
 }
 async add(name,type,bytes,kind,spec){
  await this.ensureLoaded();
  if(!(bytes instanceof Uint8Array)||bytes.length>22_000_000||bytes.length===0)throw Error('素材サイズが範囲外です');
  if(this.assets.length>=MEDIA_LIMITS.assets||
     this.assets.reduce((n,a)=>n+a.bytes.length,0)+bytes.length>MEDIA_LIMITS.projectBytes)
   throw Error('素材の個数または合計容量が上限です');
  const id=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'_'+Math.random().toString(16).slice(2);
  const asset={id,name,type,bytes,kind,spec,created:new Date().toISOString()};
  // Recover an entire session-only workspace atomically, never just the last asset.
  if(this.storageState==='session')await this.checkSessionRecovery();
  const saved=this.storageState==='session'?
    await replaceAssetsTransaction([...this.assets,asset]):await dbOp('put',asset);
  if(saved===false||(saved===null&&this.storageState==='saved'))
   throw Error('端末への保存に失敗しました。既存の作品を保持しました');
  this.storageState=saved===null?'session':'saved';
  this.assets.push(asset);return asset;
 }
 async remove(id){
  await this.ensureLoaded();
  const next=this.assets.filter(a=>a.id!==id);
  if(next.length===this.assets.length)return;
  if(this.storageState==='session')await this.checkSessionRecovery();
  const saved=this.storageState==='session'?
    await replaceAssetsTransaction(next):await dbOp('delete',id);
  if(saved===false||(saved===null&&this.storageState==='saved'))
   throw Error('端末保存に失敗したため削除しませんでした');
  this.storageState=saved===null?'session':'saved';
  this.assets=next;
 }
 async clear(){
  await this.ensureLoaded();
  if(this.storageState==='session')await this.checkSessionRecovery();
  const saved=await dbOp('clear');
  if(saved===false||(saved===null&&this.storageState==='saved'))
   throw Error('端末保存に失敗したため既存素材を保持しました');
  this.storageState=saved===null?'session':'saved';
  this.assets=[];
 }
 async makeImage(p=this.project){const s=this.buildSpec(p),canvas=makeCanvas(s.width,s.height);renderMediaScene(canvas.getContext('2d'),s,0);const bytes=await toPng(canvas);return this.add(`media_${Date.now()}.png`,'image/png',bytes,'image',s);}
 async makeAudio(p=this.project){const spec=audioSpec({kind:p.kind,seconds:Number(p.frames)/Number(p.fps),seed:Number(p.seed),text:p.text,pitch:this.buildSpec(p).controls.pitch}),bytes=wavBytes(spec);return this.add(`audio_${Date.now()}.wav`,'audio/wav',bytes,'audio',spec);}
 async makeGif(p=this.project){const origin=this.buildSpec(p),s={...origin,width:Math.min(320,origin.width),height:Math.min(180,origin.height)},frames=[],canvas=makeCanvas(s.width,s.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  for(let i=0;i<s.frames;i++){renderMediaScene(ctx,s,i/s.fps);frames.push(rgbaToIndex(ctx.getImageData(0,0,s.width,s.height).data,s.width,s.height));if(i%5===0)await new Promise(resolve=>setTimeout(resolve,0));}
  const bytes=gifBytes(frames,s.width,s.height,s.fps);return this.add(`animation_${Date.now()}.gif`,'image/gif',bytes,'animation',s);
 }
 async makeWebm(p=this.project){
  const origin=this.buildSpec(p),s={...origin,width:Math.min(320,origin.width),height:Math.min(180,origin.height)};
  if(typeof MediaRecorder==='undefined'||typeof AudioContext==='undefined')throw Error('このブラウザはWebM録画・音声合成に対応しません。GIFとWAVは利用可能です。');
  const type=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));if(!type)throw Error('WebMエンコーダがありません。GIFで書き出してください。');
  const canvas=makeCanvas(s.width,s.height),ctx=canvas.getContext('2d'),ac=new AudioContext(),stream=canvas.captureStream(s.fps),dest=ac.createMediaStreamDestination();let rec=null;
  try{
   const spec=audioSpec({kind:p.kind,seconds:s.frames/s.fps,seed:s.seed,text:p.text,pitch:s.controls.pitch}),a=synthSamples(spec),audio=ac.createBuffer(1,a.samples.length,a.rate);audio.copyToChannel(a.samples,0);const source=ac.createBufferSource();source.buffer=audio;source.connect(dest);
   const joined=new MediaStream([...stream.getVideoTracks(),...dest.stream.getAudioTracks()]);rec=new MediaRecorder(joined,{mimeType:type,videoBitsPerSecond:500_000,audioBitsPerSecond:64_000});let chunks=[];
   const finished=new Promise((resolve,reject)=>{rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onerror=e=>reject(Error(e.error?.message||'録画エラー'));rec.onstop=async()=>{try{resolve(new Uint8Array(await new Blob(chunks,{type}).arrayBuffer()));}catch(err){reject(err);}};});
   renderMediaScene(ctx,s,0);await ac.resume();rec.start(200);source.start();
   for(let i=0;i<s.frames;i++){renderMediaScene(ctx,s,i/s.fps);await new Promise(resolve=>setTimeout(resolve,1000/s.fps));}
   if(rec.state!=='inactive')rec.stop();const bytes=await Promise.race([finished,new Promise((_,reject)=>setTimeout(()=>reject(Error('WebM保存タイムアウト')),3500))]);
   if(bytes.length<100)throw Error('WebMが空です');return await this.add(`movie_${Date.now()}.webm`,'video/webm',bytes,'video',s);
  }finally{try{if(rec&&rec.state!=='inactive')rec.stop();}catch{}stream.getTracks().forEach(x=>x.stop());dest.stream.getTracks().forEach(x=>x.stop());await ac.close();}
 }
 async generate(kind,override=null){if(this.busy)throw Error('すでに生成中です');this.busy=true;try{const p=override?{...this.project,...override}:this.project;switch(kind){case'image':return await this.makeImage(p);case'audio':return await this.makeAudio(p);case'gif':return await this.makeGif(p);case'webm':return await this.makeWebm(p);default:throw Error('生成種別が不正です');}}finally{this.busy=false;}}
 async generateBatch(kinds,override=null){
  if(this.busy)throw Error('すでに生成中です');
  this.busy=true;const results=[],p=override?{...this.project,...override}:this.project;
  try{
   for(const kind of kinds){
    if(kind==='image')results.push(await this.makeImage(p));
    else if(kind==='audio')results.push(await this.makeAudio(p));
    else if(kind==='gif')results.push(await this.makeGif(p));
    else if(kind==='webm')results.push(await this.makeWebm(p));
    else throw Error('生成種別が不正です');
   }
   return results;
  }catch(error){
   if(results.length)throw Error(`${results.length}/${kinds.length}件の素材を生成済みですが途中停止しました。作品ZIPで退避できます。原因：${error.message}`);
   throw error;
  }finally{this.busy=false;}
 }
 download(asset){fileDownload(asset.bytes,asset.name,asset.type);}
 exportZip(){const manifest={format:'solzero-media-v012',version:1,project:{...this.project,wsp:this.wsp.snapshot()},assets:this.assets.map((a,i)=>({file:`assets/a${String(i).padStart(2,'0')}.${a.name.split('.').at(-1)}`,kind:a.kind,mime:a.type,originalName:a.name,spec:a.spec,created:a.created}))};const entries=[{name:'project.json',bytes:JSON.stringify(manifest,null,2)},...manifest.assets.map((a,i)=>({name:a.file,bytes:this.assets[i].bytes}))];const bytes=zipBytes(entries);fileDownload(bytes,'SolZero_media_project.zip','application/zip');return bytes.length;}
 async importZip(file){
  await this.ensureLoaded();
  if(!file||file.size>MEDIA_LIMITS.projectBytes+100_000)throw Error('ZIP上限超過');
  const entries=unzipStored(new Uint8Array(await file.arrayBuffer()));
  const manifestFile=entries.find(entry=>entry.name==='project.json');
  if(!manifestFile||manifestFile.bytes.length>262144)throw Error('project.jsonがないか長すぎます');
  const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestFile.bytes));
  if(!m||m.format!=='solzero-media-v012'||m.version!==1||!Array.isArray(m.assets)||
     m.assets.length>MEDIA_LIMITS.assets||entries.length!==m.assets.length+1)
   throw Error('プロジェクト形式または素材一覧が不正です');
  const index=new Map(entries.map(entry=>[entry.name,entry])),referenced=new Set(),next=[];
  for(const item of m.assets){
   if(!item||typeof item.file!=='string'||!/^assets\/a\d{2}\.(png|gif|jpg|jpeg|wav|mp3|webm|mp4)$/.test(item.file)||
      referenced.has(item.file))throw Error('素材名が不正または重複しています');
   referenced.add(item.file);
   const source=index.get(item.file),type=mimeFor(item.file),name=item.originalName??item.file;
   if(!source||!source.bytes.length||source.bytes.length>22_000_000||item.mime!==type||
      typeof name!=='string'||!name||name.length>120||
      typeof item.kind!=='string'||item.kind.length>40||
      (item.spec!==undefined&&(!item.spec||typeof item.spec!=='object'||Array.isArray(item.spec)))||
      (item.created!==undefined&&(typeof item.created!=='string'||item.created.length>48)))
    throw Error('素材と説明が不一致です');
   const id=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():String(Date.now()+next.length);
   next.push({id,name,type,bytes:source.bytes,kind:item.kind,spec:item.spec||{},created:item.created||new Date().toISOString()});
  }
  if(next.reduce((n,a)=>n+a.bytes.length,0)>MEDIA_LIMITS.projectBytes)throw Error('総容量が多すぎます');
  const p=m.project;
  if(!p||typeof p!=='object'||Array.isArray(p)||
     typeof p.name!=='string'||p.name.length>60||
     typeof p.prompt!=='string'||p.prompt.length>180||
     typeof p.text!=='string'||p.text.length>200||
     typeof p.kind!=='string'||!['ambient','waves','wind','tones','robot'].includes(p.kind)||
     !['seed','width','height','frames','fps'].every(k=>Number.isInteger(p[k])))
   throw Error('作品の設定が不正です');
  const verified=validateMediaSpec({...p,theme:p.theme==='auto'?undefined:p.theme});
  audioSpec({kind:p.kind,seconds:p.frames/p.fps,seed:p.seed,text:p.text});
  const newWsp=new MediaWSP();
  if(p.wsp!==undefined&&!newWsp.restore(p.wsp))throw Error('作品内のWSP重みが不正です');
  const project={name:p.name,prompt:p.prompt,seed:verified.seed,theme:p.theme==='auto'?'auto':verified.theme,
   width:verified.width,height:verified.height,frames:verified.frames,fps:verified.fps,kind:p.kind,text:p.text};
  // Validate everything before attempting a single, all-or-nothing storage transaction.
  if(this.storageState==='session')await this.checkSessionRecovery();
  const persisted=await replaceAssetsTransaction(next);
  if(persisted===false||(persisted===null&&this.storageState==='saved'))
   throw Error('保存領域の更新に失敗したため、元の作品を保持しました');
  this.assets=next;this.storageState=persisted===true?'saved':'session';
  this.project=project;this.wsp=newWsp;this.saveRecipe();
  return next.length;
 }
 async importMedia(files){let added=0;for(const f of [...files]){const type=mimeFor(f.name);if(!type||f.type && type!==f.type||f.size>22_000_000)continue;await this.add(`imported_${Date.now()}_${added}.${f.name.split('.').at(-1).toLowerCase()}`,type,new Uint8Array(await f.arrayBuffer()),'import',{originalName:f.name.slice(0,100)});added++;}return added;}
 render(root,helpers){const {notify}=helpers;root.replaceChildren();const notice=element('p','生成AIではなく、コードから直接画像・波形・フレームを作る独自エンジンです。学習済みモデル・通信・外部APIなし。WebMはブラウザ対応時のみ音声入りで生成します。');notice.className='muted';root.append(notice);
  const storage=element('p',this.storageState==='saved'?
    '素材保存：端末内のIndexedDBへ完了後に反映します。':
    '注意：素材は一時保存です。画面終了前に作品ZIPを書き出してください。');
  storage.className='muted';root.append(storage);
  if(!this.recipeSaved){const warning=element('p','注意：制作設定は端末に保存されていません。作品ZIPで退避してください。');warning.className='muted';root.append(warning);}
  const setRow=(label,type,value,options=null)=>{const row=element('div');row.className='field';const caption=element('label',label),input=options?element('select'):element(type==='textarea'?'textarea':'input');if(!options&&type!=='textarea')input.type=type;if(options)for(const [val,text] of options){const option=element('option',text);option.value=val;input.append(option);}input.value=String(value);caption.append(input);row.append(caption);root.append(row);return input;};
  const name=setRow('作品名','text',this.project.name),prompt=setRow('生成指示（対応テーマ：宇宙・海・山・森・街・花・雨・雪・夕焼け・抽象）','textarea',this.project.prompt);
  const seed=setRow('乱数シード','number',this.project.seed),theme=setRow('画風','text',this.project.theme,[['auto','指示から自動選択'],...['space','sea','mountain','forest','city','flowers','rain','snow','sunset','abstract'].map(x=>[x,x])]);
  const dims=setRow('画像サイズ','text',`${this.project.width}x${this.project.height}`,[['512x288','512×288'],['768x432','768×432'],['320x180','320×180'],['1024x576','1024×576']]);
  const duration=setRow('動画長（フレーム数）','text',`${this.project.frames}`,[['16','2秒'],['24','3秒'],['32','4秒'],['48','6秒']]);
  const sound=setRow('音の種類','text',this.project.kind,[['ambient','アンビエント'],['waves','波音'],['wind','風音'],['tones','オリジナル電子音'],['robot','簡易ロボット声（音素風）']]);
  const speech=setRow('ロボット声の文字','text',this.project.text);
  const log=element('div','準備完了。生成結果は端末に保存されます（対応ブラウザのIndexedDB）。');log.className='listentry';root.append(log);
  const btnrow=element('div');btnrow.className='buttons';root.append(btnrow);
  const collect=()=>{const [w,h]=dims.value.split('x').map(Number);const p={name:name.value.slice(0,60),prompt:prompt.value,seed:Number(seed.value),theme:theme.value,width:w,height:h,frames:Number(duration.value),fps:8,kind:sound.value,text:speech.value};this.buildSpec(p);audioSpec({kind:p.kind,seconds:p.frames/p.fps,seed:p.seed,text:p.text});this.project=p;this.saveRecipe();return p;};
  const action=(label,fn)=>{const b=element('button',label);b.className='btn primary';b.addEventListener('click',async()=>{
  if(this.uiBusy||this.busy)return;
  this.uiBusy=true;
  try{
   const p=collect();b.disabled=true;log.textContent='処理中：'+label;
   const result=await fn(p);
   log.textContent=typeof result==='string'?result:`生成完了：${result.name}（${result.bytes.length.toLocaleString('ja-JP')}バイト）`;
  }catch(err){log.textContent='エラー：'+err.message;}
  finally{this.drawAssets(list,notify);b.disabled=false;this.uiBusy=false;}
 });btnrow.append(b);};
  action('画像 PNG',p=>this.generate('image',p));action('音声 WAV',p=>this.generate('audio',p));action('動画 GIF',p=>this.generate('gif',p));action('音声付き動画 WebM',p=>this.generate('webm',p));
  action('画像＋音声＋GIF一括',async p=>{const assets=await this.generateBatch(['image','audio','gif'],p);return `${assets.length}種類の素材を生成しました。作品ZIPで一括取得できます。`;});
  const extras=element('div');extras.className='buttons';root.append(extras);
  const extra=(label,fn)=>{const b=element('button',label);b.className='btn';b.addEventListener('click',async()=>{
  if(this.uiBusy||this.busy)return;
  this.uiBusy=true;
  try{await fn();}catch(error){log.textContent='操作を中止：'+error.message;}
  finally{this.uiBusy=false;}
 });extras.append(b);};
  extra('全素材をZIPで書き出し',()=>{try{log.textContent='作品ZIP保存：'+this.exportZip().toLocaleString('ja-JP')+'バイト';}catch(e){log.textContent='ZIPエラー：'+e.message;}});
  const inp=element('input');inp.type='file';inp.accept='.zip,application/zip';inp.className='hidden';root.append(inp);
  extra('作品ZIPを復元',()=>inp.click());inp.addEventListener('change',async()=>{const file=inp.files?.[0];inp.value='';if(!file)return;if(this.uiBusy||this.busy)return;
  if(!confirm('現在のメディア作品と素材を、ZIPの内容で置き換えます。続けますか？'))return;
  this.uiBusy=true;
  try{const count=await this.importZip(file);this.render(root,helpers);const notice=root.querySelector('.listentry');if(notice)notice.textContent=`作品復元完了：${count}素材`;}
  catch(e){log.textContent='ZIP復元拒否：'+e.message;}
  finally{this.uiBusy=false;}});
  const importInput=element('input');importInput.type='file';importInput.accept='image/png,image/jpeg,image/gif,audio/wav,audio/mpeg,video/mp4,video/webm';importInput.multiple=true;importInput.className='hidden';root.append(importInput);
  extra('端末の素材を取り込む',()=>importInput.click());importInput.addEventListener('change',async()=>{const files=[...importInput.files];importInput.value='';
  if(this.uiBusy||this.busy)return;
  this.uiBusy=true;
  try{const count=await this.importMedia(files);log.textContent=`端末素材 ${count}件を取り込みました。ZIPに統合できます。`;}
  catch(e){log.textContent='取込制限：'+e.message;}
  finally{this.drawAssets(list,notify);this.uiBusy=false;}});
  extra('全部削除',async()=>{if(!confirm('生成素材・取り込んだ素材をすべて削除しますか？'))return;try{await this.clear();this.drawAssets(list,notify);}catch(e){log.textContent='削除を中止：'+e.message;}});
  const preview=makeCanvas(320,180);preview.style.cssText='max-width:100%;height:auto;border-radius:12px;border:1px solid var(--line);margin:8px 0';root.append(preview);
  extra('指定からプレビュー',()=>{try{const s=this.buildSpec(collect());renderMediaScene(preview.getContext('2d'),{...s,width:320,height:180},0);notify('プレビュー更新');}catch(e){log.textContent='プレビュー失敗：'+e.message;}});
  try{renderMediaScene(preview.getContext('2d'),{...this.buildSpec(),width:320,height:180},0);}catch{}
  root.append(element('h3','メディアWSP：生成制御重み 4×3'));
  root.append(element('p','テーマ特徴を入力とする4行×3列の重みを直接編集します。出力は描画密度・動作速度・音程へ反映されます。自然言語理解や学習済み画像生成ではありません。'));
  const ww=element('div');ww.className='buttons';root.append(ww);
  const rows=[['0','宇宙'],['1','海・夕焼'],['2','自然・天候'],['3','都市・抽象']];
  const cols=[['0','描画密度'],['1','動作速度'],['2','音程']];
  const mkSelect=(data)=>{const x=element('select');for(const [v,label] of data){const o=element('option',label);o.value=v;x.append(o);}return x;};
  const wr=mkSelect(rows),wc=mkSelect(cols),wv=element('input');wv.type='number';wv.min='-1.5';wv.max='1.5';wv.step='0.05';wv.value='0.5';wv.style.maxWidth='90px';ww.append(wr,wc,wv);
  const report=element('div');report.className='listentry';const reportRefresh=()=>{report.textContent=`直接設定した重み：${JSON.stringify(this.wsp.weights)}\n現在の画風への出力：${JSON.stringify(this.wsp.controls(this.buildSpec().theme))}`;};
  const edit=element('button','重みを設定'),undo=element('button','戻す');edit.className='btn primary';undo.className='btn';edit.addEventListener('click',()=>{if(this.uiBusy||this.busy)return;try{this.wsp.edit(Number(wr.value),Number(wc.value),Number(wv.value));this.saveRecipe();reportRefresh();notify('生成制御の重みを更新');}catch(e){report.textContent=e.message;}});
  undo.addEventListener('click',()=>{if(this.uiBusy||this.busy)return;this.wsp.rollback();this.saveRecipe();reportRefresh();});ww.append(edit,undo);root.append(report);reportRefresh();
  root.append(element('h3','作品に含まれる素材（最大16件／合計55MB）'));const list=element('div');root.append(list);this.drawAssets(list,notify);
 }
 drawAssets(root,notify){for(const url of this.previewUrls)URL.revokeObjectURL(url);this.previewUrls.clear();root.replaceChildren();const total=this.assets.reduce((s,a)=>s+a.bytes.length,0);root.append(element('p',`${this.assets.length}件・${(total/1024/1024).toFixed(2)} MiB。画像・音声・動画を同じプロジェクトとしてZIPに保存できます。`));
  for(const a of this.assets){const entry=element('div');entry.className='listentry';entry.append(element('b',`${a.kind}: ${a.name} (${Math.round(a.bytes.length/1024)}KB)`));const blob=new Blob([a.bytes],{type:a.type}),url=URL.createObjectURL(blob);this.previewUrls.add(url);const media=a.type.startsWith('image/')?element('img'):a.type.startsWith('audio/')?element('audio'):a.type.startsWith('video/')?element('video'):null;
   if(media){media.src=url;media.style.cssText='display:block;max-width:100%;max-height:190px;object-fit:contain;margin:8px 0;border-radius:8px';if(media.tagName!=='IMG'){media.controls=true;if(media.tagName==='VIDEO')media.muted=false;}entry.append(media);}else URL.revokeObjectURL(url);
   const buttons=element('div');buttons.className='buttons';const dl=element('button','保存');dl.className='btn';dl.addEventListener('click',()=>this.download(a));const del=element('button','削除');del.className='btn danger';del.addEventListener('click',async()=>{
    if(this.uiBusy||this.busy)return;
    this.uiBusy=true;
    try{await this.remove(a.id);this.drawAssets(root,notify);}
    catch(err){notify('削除を中止：'+err.message);}
    finally{this.uiBusy=false;}
   });buttons.append(dl,del);entry.append(buttons);root.append(entry);
  }
 }
}
