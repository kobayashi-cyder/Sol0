/**
 * Opt-in ComfyUI local image provider. No remote hosts, credentials, redirect,
 * automatic background generation, model downloads or Android permissions.
 * Requires a separately running ComfyUI API server + checkpoint + browser CORS.
 */
import {buildPhotorealPrompt} from './image_prompt_builder.js';

export const COMFY_LIMITS=Object.freeze({
 maxImageBytes:22_000_000,maxJsonBytes:524_288,
 defaultPollMs:1000,minTimeoutMs:15000,maxTimeoutMs:300000
});
const SAMPLERS=new Set(['euler','euler_ancestral','dpmpp_2m','dpmpp_sde','heun']);
const SCHEDULERS=new Set(['normal','karras','simple']);
const PNG_SIGNATURE=[137,80,78,71,13,10,26,10];

export function normalizeComfyOrigin(origin='http://127.0.0.1:8188'){
 if(typeof origin!=='string'||origin.length>120)throw Error('ローカルURLが不正です');
 let url;
 try{url=new URL(origin);}catch{throw Error('ComfyUIのURLが不正です');}
 if(url.protocol!=='http:'||
    !['127.0.0.1','localhost'].includes(url.hostname)||
    !url.port||url.username||url.password||
    url.pathname!=='/'||url.search||url.hash){
   throw Error('ComfyUIはhttp://127.0.0.1:8188等のループバックURLのみ対応です');
 }
 return url.origin;
}

function validateCheckpoint(name){
 if(typeof name!=='string'||name.length<5||name.length>200||
   !/^[\p{L}\p{N} _./()\-]+$/u.test(name)||
   name.startsWith('/')||name.includes('//')||
   name.split('/').some(part=>!part||part==='.'||part==='..')||
   !/\.(?:safetensors|ckpt)$/i.test(name)){
   throw Error('ComfyUIのcheckpointsにあるモデルファイル名を指定してください');
 }
 return name;
}
function uint(n,min,max,label){
 if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'が範囲外です');
 return n;
}
function configuration(options={}){
 const origin=normalizeComfyOrigin(options.baseUrl);
 const checkpoint=validateCheckpoint(options.checkpoint);
 const steps=uint(Number(options.steps??20),4,50,'steps');
 const cfg=Number(options.cfg??7);
 if(!Number.isFinite(cfg)||cfg<1||cfg>20)throw Error('CFGが範囲外です');
 const sampler=options.sampler??'euler';
 const scheduler=options.scheduler??'normal';
 if(!SAMPLERS.has(sampler)||!SCHEDULERS.has(scheduler))throw Error('Sampler/Schedulerが不正です');
 const timeoutMs=uint(Number(options.timeoutMs??180000),COMFY_LIMITS.minTimeoutMs,
   COMFY_LIMITS.maxTimeoutMs,'生成待機時間');
 const pollMs=uint(Number(options.pollMs??COMFY_LIMITS.defaultPollMs),100,5000,'更新間隔');
 return Object.freeze({origin,checkpoint,steps,cfg,sampler,scheduler,timeoutMs,pollMs});
}

/** ComfyUI API-format workflow (not its visual editor workflow JSON). */
export function buildComfyWorkflow(job,options){
 const c=configuration(options);
 const p=buildPhotorealPrompt(job,{negativePrompt:options.negativePrompt??
   'blurry, watermark, signature, low resolution, distorted anatomy'});
 if(p.width%8||p.height%8)throw Error('ComfyUI画像の縦横は8の倍数にしてください');
 return Object.freeze({
   '4':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:c.checkpoint}},
   '5':{class_type:'EmptyLatentImage',inputs:{
     width:p.width,height:p.height,batch_size:1}},
   '6':{class_type:'CLIPTextEncode',inputs:{text:p.positive,clip:['4',1]}},
   '7':{class_type:'CLIPTextEncode',inputs:{text:p.negative,clip:['4',1]}},
   '3':{class_type:'KSampler',inputs:{
     seed:p.seed,steps:c.steps,cfg:c.cfg,sampler_name:c.sampler,
     scheduler:c.scheduler,denoise:1,model:['4',0],
     positive:['6',0],negative:['7',0],latent_image:['5',0]}},
   '8':{class_type:'VAEDecode',inputs:{samples:['3',0],vae:['4',2]}},
   '9':{class_type:'SaveImage',inputs:{filename_prefix:'Sol0_photoreal',images:['8',0]}}
 });
}
function makePath(origin,path,params){
 const u=new URL(origin+path);
 if(params)for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
 return u.href;
}
async function readJSON(response,label){
 if(response.redirected)throw Error('ComfyUIがリダイレクトしました');
 if(!response.ok)throw Error(label+'がHTTP '+(response.status??'エラー')+'を返しました');
 const declared=Number(response.headers?.get?.('content-length')??0);
 if(Number.isFinite(declared)&&declared>COMFY_LIMITS.maxJsonBytes)
   throw Error('ComfyUIの応答が大きすぎます');
 const raw=await response.text();
 if(raw.length>COMFY_LIMITS.maxJsonBytes)throw Error('ComfyUIのJSONが大きすぎます');
 let json;
 try{json=JSON.parse(raw);}catch{throw Error('ComfyUIのJSON応答が不正です');}
 if(!json||typeof json!=='object'||Array.isArray(json))throw Error('ComfyUIの応答形式が不正です');
 return json;
}
function validateOutputImage(info){
 if(!info||typeof info!=='object'||info.type!=='output'||
   typeof info.filename!=='string'||info.filename.length>180||
   !/^[^/\\\x00-\x1f]+\.png$/i.test(info.filename)||
   info.filename==='.'||info.filename==='..'||
   typeof info.subfolder!=='string'||info.subfolder.length>160||
   info.subfolder.startsWith('/')||info.subfolder.includes('\\')||
   info.subfolder.split('/').some(s=>s==='..'||s==='.')){
   throw Error('ComfyUIの出力画像名または保存場所が不正です');
 }
 return {filename:info.filename,subfolder:info.subfolder,type:'output'};
}
function pngDimensions(bytes){
 if(bytes.length<24||PNG_SIGNATURE.some((b,i)=>bytes[i]!==b)||
    [bytes[12],bytes[13],bytes[14],bytes[15]].join(',')!=='73,72,68,82'){
   throw Error('ComfyUIの結果がPNG形式ではありません');
 }
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const w=view.getUint32(16),h=view.getUint32(20);
 if(w<1||h<1||w>4096||h>4096)throw Error('生成PNGの寸法が不正です');
 return {width:w,height:h};
}
async function readPNG(response){
 if(response.redirected)throw Error('ComfyUI画像がリダイレクトされました');
 if(!response.ok)throw Error('画像取得に失敗しました（HTTP '+(response.status??'?')+'）');
 const length=Number(response.headers?.get?.('content-length')??0);
 if(Number.isFinite(length)&&length>COMFY_LIMITS.maxImageBytes)
   throw Error('生成画像が22MBの上限を超えています');
 const raw=new Uint8Array(await response.arrayBuffer());
 if(raw.length>COMFY_LIMITS.maxImageBytes||!raw.length)
   throw Error('生成画像の容量が不正です');
 const dims=pngDimensions(raw);
 return {bytes:raw,...dims};
}

export function createComfyUIProvider(options,dependencies={}){
 const config=configuration(options);
 const fetchImpl=dependencies.fetchImpl??globalThis.fetch;
 const sleepImpl=dependencies.sleepImpl??(ms=>new Promise(r=>setTimeout(r,ms)));
 const now=dependencies.now??(()=>Date.now());
 if(typeof fetchImpl!=='function')throw Error('fetch is unavailable');
 const request=(path,method='GET',body=null,ms=15000,params=null)=>{
   const init={method,mode:'cors',credentials:'omit',redirect:'error',
     cache:'no-store',signal:AbortSignal.timeout(ms)};
   if(body!==null){init.headers={'Content-Type':'application/json'};
     init.body=JSON.stringify(body);}
   return fetchImpl(makePath(config.origin,path,params),init);
 };
 return Object.freeze({
   kind:'comfyui',
   endpoint:config.origin,
   async available(){
     const result=await readJSON(await request('/system_stats'),'ComfyUI接続確認');
     if(!result.system||typeof result.system!=='object')
       throw Error('ComfyUI APIの応答形式が一致しません');
     return true;
   },
   async generate(job,{consent=false}={}){
     if(consent!==true)throw Error('画像ごとの明示的な送信同意が必要です');
     const workflow=buildComfyWorkflow(job,options);
     const start=now();
     const queued=await readJSON(await request('/prompt','POST',{prompt:workflow}),
       'ComfyUIキューへの送信');
     const id=queued.prompt_id;
     if(typeof id!=='string'||id.length<8||id.length>128||
        !/^[a-zA-Z0-9-]+$/.test(id)){
       throw Error('ComfyUIが有効なprompt_idを返しませんでした');
     }
     let image=null;
     // No websocket or background tasks; request terminates after bounded time.
     for(let polls=0;polls<600;polls++){
       if(now()-start>=config.timeoutMs)throw Error('ComfyUIの画像生成が時間切れです');
       const history=await readJSON(await request('/history/'+encodeURIComponent(id)),
         'ComfyUI画像生成履歴');
       const item=history[id];
       if(item&&typeof item==='object'){
         if(item.status?.status_str==='error')throw Error('ComfyUIで生成エラーが発生しました');
         if(item.status?.completed===true || item.outputs){
           const images=item.outputs?.['9']?.images;
           if(!Array.isArray(images)||!images.length)
             throw Error('ComfyUIのSaveImage出力がありません');
           image=validateOutputImage(images[0]);
           break;
         }
       }
       await sleepImpl(config.pollMs);
     }
     if(!image)throw Error('ComfyUIの画像生成待機回数を超えました');
     const response=await request('/view','GET',null,20000,image);
     const png=await readPNG(response);
     return Object.freeze({
       kind:'comfyui',mime:'image/png',bytes:png.bytes,
       width:png.width,height:png.height,
       promptId:id,seed:Number(job.seed),model:config.checkpoint,
       elapsedMs:Math.max(0,now()-start),
       source:'user-authorized loopback ComfyUI; independent model not bundled'
     });
   }
 });
}
