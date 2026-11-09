import test from 'node:test';
import assert from 'node:assert/strict';
import {
 normalizeComfyOrigin,buildComfyWorkflow,createComfyUIProvider,COMFY_LIMITS
} from '../chat_web/image_provider_comfyui.js';
import {createImageProvider} from '../chat_web/image_provider.js';
import {buildPhotorealPrompt} from '../chat_web/image_prompt_builder.js';

const options=Object.freeze({
 baseUrl:'http://127.0.0.1:8188',checkpoint:'local-sdxl.safetensors',
 steps:18,cfg:6,sampler:'euler',scheduler:'karras',
 timeoutMs:15000,pollMs:100
});
const job=Object.freeze({
 prompt:'左に赤い猫、右に青いロボット、夕焼けの海',
 seed:2026,width:512,height:288,theme:'sea'
});
const id='mock-prompt-123';
function reply(body,status=200){
 return {
  ok:status>=200&&status<300,status,redirected:false,
  headers:{get(){return null;}},
  text:async()=>JSON.stringify(body)
 };
}
function png(width=512,height=288){
 // Mocked binary structure: provider validates magic/IHDR/IEND and dimensions;
 // browser integration uses an actually encoded PNG.
 const bytes=new Uint8Array(70);
 bytes.set([137,80,78,71,13,10,26,10],0);
 bytes[11]=13;bytes.set([73,72,68,82],12);
 const dv=new DataView(bytes.buffer);
 dv.setUint32(16,width);dv.setUint32(20,height);
 bytes.set([73,69,78,68],bytes.length-8);
 bytes.set([174,66,96,130],bytes.length-4);
 return bytes;
}
function imageResponse(bytes=png(),status=200){
 return {ok:status===200,status,redirected:false,headers:{get(){return bytes.length.toString();}},
  arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
function mockComfy({image=png(),historyDelay=1,historyOverride=null,queued=null,
 errorStatus=null}={}){
 const calls=[],requestBodies=[];
 let polls=0;
 const fetchImpl=async(url,init)=>{
  calls.push({url,init});
  const path=new URL(url);
  if(errorStatus&&path.pathname===errorStatus.path)return reply({error:'test'},errorStatus.code);
  if(path.pathname==='/system_stats')return reply({system:{os:'linux'}});
  if(path.pathname==='/prompt'){
   requestBodies.push(JSON.parse(init.body));
   return reply(queued??{prompt_id:id,number:1});
  }
  if(path.pathname==='/history/'+id){
   polls++;
   return reply(historyOverride??(polls<=historyDelay?{}:{
     [id]:{status:{completed:true,status_str:'success'},
     outputs:{'9':{images:[{filename:'Sol0_00001.png',subfolder:'',type:'output'}]}}}
   }));
  }
  if(path.pathname==='/view')return imageResponse(image);
  throw Error('Unexpected ComfyUI route: '+path.pathname);
 };
 return {fetchImpl,calls,requestBodies,get polls(){return polls;}};
}

test('localhost-only provider rejects all remote, credentialed, redirected or non-root origins',()=>{
 assert.equal(normalizeComfyOrigin('http://127.0.0.1:8188/'),'http://127.0.0.1:8188');
 assert.equal(normalizeComfyOrigin('http://localhost:8188'),'http://localhost:8188');
 for(const invalid of [
  'http://192.168.1.10:8188','http://127.0.0.2:8188',
  'http://localhost.evil.example:8188','https://127.0.0.1:8188',
  'http://user:password@127.0.0.1:8188','http://127.0.0.1:8188/api',
  'http://127.0.0.1:8188/?auth=secret','http://127.0.0.1:8188/#secret',
  'http://[::1]:8188','file:///tmp/comfy','http://localhost:8188@evil.example'
 ])assert.throws(()=>normalizeComfyOrigin(invalid),/ループバック|URL/);
});

test('scene interpretation retains original Japanese prompt and maps left/right/color',()=>{
 const p=buildPhotorealPrompt(job,{negativePrompt:'blurry, watermark'});
 assert.match(p.positive,/photorealistic photograph/);
 assert.match(p.positive,/red cat on the left/);
 assert.match(p.positive,/blue robot on the right/);
 assert.match(p.positive,/夕焼けの海/);
 assert.equal(p.negative,'blurry, watermark');
 assert.equal(p.seed,2026);
 assert.equal(p.width,512);
 assert.equal(p.subjects,2);
 assert.throws(()=>buildPhotorealPrompt({...job,seed:-1}),/範囲/);
 assert.throws(()=>buildPhotorealPrompt({...job,prompt:'a'.repeat(181)}),/長すぎ/);
 assert.throws(()=>buildPhotorealPrompt(job,{negativePrompt:'a'.repeat(501)}),/長すぎ/);
});

test('ComfyUI API workflow has valid typed txt2img node graph with bounded parameters',()=>{
 const w=buildComfyWorkflow(job,options);
 assert.deepEqual(Object.keys(w).sort(),['3','4','5','6','7','8','9']);
 assert.equal(w['4'].inputs.ckpt_name,'local-sdxl.safetensors');
 assert.deepEqual(w['3'].inputs.positive,['6',0]);
 assert.deepEqual(w['3'].inputs.negative,['7',0]);
 assert.deepEqual(w['3'].inputs.model,['4',0]);
 assert.deepEqual(w['3'].inputs.latent_image,['5',0]);
 assert.equal(w['3'].inputs.seed,2026);
 assert.equal(w['3'].inputs.cfg,6);
 assert.equal(w['5'].inputs.width,512);
 assert.equal(w['9'].class_type,'SaveImage');
 for(const ckpt of ['../../secret.safetensors','http://evil.net/x.ckpt',
   '/root/model.ckpt','model.bat','a\\evil.ckpt']){
  assert.throws(()=>buildComfyWorkflow(job,{...options,checkpoint:ckpt}),/モデルファイル名/);
 }
 assert.throws(()=>buildComfyWorkflow(job,{...options,steps:100}),/steps/);
 assert.throws(()=>buildComfyWorkflow(job,{...options,timeoutMs:999}),/時間/);
 assert.throws(()=>buildComfyWorkflow({...job,width:513},options),/8の倍数/);
});

test('default none provider refuses to use any network or claim generation',async()=>{
 const provider=createImageProvider({type:'none'});
 assert.equal(provider.kind,'none');
 assert.equal(await provider.available(),false);
 await assert.rejects(provider.generate(job),/未接続/);
 assert.throws(()=>createImageProvider({type:'untrusted'}),/種別/);
});

test('one explicit consent leads to queue, history polling and verified PNG only',async()=>{
 const m=mockComfy();
 const provider=createImageProvider({type:'comfyui',...options},
   {fetchImpl:m.fetchImpl,sleepImpl:async()=>{}});
 assert.equal(await provider.available(),true);
 const result=await provider.generate(job,{consent:true});
 assert.equal(result.kind,'comfyui');
 assert.equal(result.mime,'image/png');
 assert.equal(result.width,512);
 assert.equal(result.height,288);
 assert.equal(result.promptId,id);
 assert.equal(result.model,options.checkpoint);
 assert.deepEqual(result.bytes,png());
 assert.equal(m.polls,2);
 assert.equal(m.requestBodies.length,1);
 assert.equal(m.requestBodies[0].prompt['3'].inputs.steps,18);
 assert.equal(m.calls.length,5);
 for(const c of m.calls){
  assert.equal(new URL(c.url).hostname,'127.0.0.1');
  assert.equal(c.init.credentials,'omit');
  assert.equal(c.init.redirect,'error');
  assert.equal(c.init.mode,'cors');
  assert.equal(c.init.signal.aborted,false);
  assert.ok(!c.init.headers||!Object.keys(c.init.headers).some(k=>/authorization|cookie/i.test(k)));
 }
 const view=new URL(m.calls.at(-1).url);
 assert.equal(view.searchParams.get('filename'),'Sol0_00001.png');
 assert.equal(view.searchParams.get('type'),'output');
});

test('no per-image consent sends no request, even if provider is configured',async()=>{
 const m=mockComfy();
 const p=createComfyUIProvider(options,{fetchImpl:m.fetchImpl});
 await assert.rejects(p.generate(job),/同意/);
 assert.equal(m.calls.length,0);
});

test('ComfyUI queue and execution errors fail closed; no deceptive offline result',async()=>{
 for(const scenario of [
  {queued:{error:'bad',node_errors:{'3':'bad'}}},
  {errorStatus:{path:'/prompt',code:503}},
  {historyOverride:{[id]:{status:{completed:true,status_str:'error'}}}},
  {historyOverride:{[id]:{status:{completed:true,status_str:'success'},outputs:{}}}}
 ]){
  const m=mockComfy(scenario);
  const p=createComfyUIProvider(options,{fetchImpl:m.fetchImpl,sleepImpl:async()=>{}});
  await assert.rejects(p.generate(job,{consent:true}));
 }
});

test('invalid image paths, fake output types, oversized and malformed PNGs are refused',async()=>{
 for(const data of [
  {filename:'../steal.png',subfolder:'',type:'output'},
  {filename:'test.png',subfolder:'../../private',type:'output'},
  {filename:'test.png',subfolder:'',type:'input'},
  {filename:'file.svg',subfolder:'',type:'output'}
 ]){
  const m=mockComfy({historyOverride:{
   [id]:{status:{completed:true,status_str:'success'},outputs:{'9':{images:[data]}}}
  }});
  const p=createComfyUIProvider(options,{fetchImpl:m.fetchImpl});
  await assert.rejects(p.generate(job,{consent:true}),/画像名|保存場所/);
 }
 for(const bad of [new Uint8Array(100),png(160,90),png(9999,288)]){
  const m=mockComfy({image:bad,historyDelay:0});
  const p=createComfyUIProvider(options,{fetchImpl:m.fetchImpl});
  await assert.rejects(p.generate(job,{consent:true}),/PNG|画像サイズ/);
 }
 assert.equal(COMFY_LIMITS.maxImageBytes,22_000_000);
});

test('poll timeout is bounded and transport errors remain visible',async()=>{
 let time=0;
 const m=mockComfy({historyOverride:{}});
 const p=createComfyUIProvider(options,{fetchImpl:m.fetchImpl,
  now:()=>time,sleepImpl:async ms=>{time+=ms;}});
 await assert.rejects(p.generate(job,{consent:true}),/時間切れ/);
 assert.ok(m.polls<200);
 const failing=createComfyUIProvider(options,{
  fetchImpl:async()=>{throw new TypeError('CORS refused');}
 });
 await assert.rejects(failing.generate(job,{consent:true}),/CORS refused/);
});
