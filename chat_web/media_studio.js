/** Sol-Zero Media Studio v0.12. Procedural synthesis only: NO pretrained weights,
 * network, content APIs, hidden model, eval/Function, or external libraries.
 * The authored scene description is a recipe, NOT semantic image generation.
 */
export const MEDIA_LIMITS=Object.freeze({width:1024,height:1024,videoWidth:320,videoHeight:180,frames:60,duration:8,sampleRate:16000,assets:16,projectBytes:55_000_000});
const enc=new TextEncoder();
const themes=[['宇宙','space'],['星','space'],['星空','space'],['space','space'],['海','sea'],['波','sea'],['sea','sea'],['山','mountain'],['mountain','mountain'],['森','forest'],['木','forest'],['forest','forest'],['街','city'],['都市','city'],['city','city'],['花','flowers'],['flower','flowers'],['雨','rain'],['rain','rain'],['雪','snow'],['snow','snow'],['夕焼','sunset'],['夕日','sunset'],['sunset','sunset']];
export function themeOf(text){const t=String(text||'').toLowerCase();return themes.find(([k])=>t.includes(k))?.[1]||'abstract';}
export function validateMediaSpec(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('仕様が不正です');
 const text=String(raw.prompt??'抽象模様').slice(0,180);if(!text.trim())throw Error('説明文を入力してください');
 const width=Number(raw.width??512),height=Number(raw.height??288),seed=Number(raw.seed??2026),frames=Number(raw.frames??24),fps=Number(raw.fps??8);
 if(!Number.isInteger(width)||width<96||width>MEDIA_LIMITS.width||!Number.isInteger(height)||height<72||height>MEDIA_LIMITS.height)throw Error('画像の寸法が範囲外です');
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('シードが不正です');
 if(!Number.isInteger(frames)||frames<2||frames>MEDIA_LIMITS.frames||!Number.isInteger(fps)||fps<2||fps>20||frames/fps>MEDIA_LIMITS.duration)throw Error('フレーム数・速度の制約を超えました');
 const theme=raw.theme??themeOf(text);if(!['space','sea','mountain','forest','city','flowers','rain','snow','sunset','abstract'].includes(theme))throw Error('画風が不正です');
 const controls=raw.controls??{density:1,motion:1,pitch:1};if(!controls||typeof controls!=='object'||!['density','motion','pitch'].every(k=>Number.isFinite(Number(controls[k]))&&Number(controls[k])>=.2&&Number(controls[k])<=3))throw Error('WSP生成制御値が不正です');
 return {prompt:text,width,height,seed,frames,fps,theme,controls:{density:Number(controls.density),motion:Number(controls.motion),pitch:Number(controls.pitch)}};
}
export function seeded(seed){let x=(seed>>>0)||0x6d2b79f5;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};}
const palettes={space:['#080c29','#4d2b77','#ef82bb','#ffffff'],sea:['#84c5e9','#0c5683','#16a4b0','#fae6b6'],mountain:['#9cd3f2','#486a82','#2b6772','#e7d69c'],forest:['#b4d8b4','#286850','#133e39','#dcb46f'],city:['#263451','#f9b875','#6c659b','#ecddaf'],flowers:['#eef8f0','#6caaa0','#d96d96','#ffd45d'],rain:['#445870','#687f96','#b3d1d9','#cad8ef'],snow:['#92b7cf','#bfdde8','#f4faff','#c4d3ef'],sunset:['#fa9b79','#ba517e','#4b3c72','#ffd7a6'],abstract:['#202d5f','#537cbb','#72d6ce','#ffc77e']};
function fill(ctx,color){ctx.fillStyle=color;}
function circle(ctx,x,y,r,color){fill(ctx,color);ctx.beginPath();ctx.arc(x,y,Math.max(.1,r),0,Math.PI*2);ctx.fill();}
function line(ctx,x1,y1,x2,y2,width,color){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
/** Render every frame from recipe + deterministic seed. Canvas2D interface. */
export function renderMediaScene(ctx,raw,time=0){
 const s=validateMediaSpec(raw),{width:w,height:h,theme,seed}=s,r=seeded(seed),p=palettes[theme];
 fill(ctx,p[0]);ctx.fillRect(0,0,w,h);
 const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,p[0]);sky.addColorStop(1,p[1]);fill(ctx,sky);ctx.fillRect(0,0,w,h);
 const t=Math.max(0,Math.min(10,Number(time)||0)),u=t*2*Math.PI*s.controls.motion/Math.max(.25,s.frames/s.fps),density=s.controls.density;
 if(theme==='space'){
  for(let i=0;i<Math.round(130*density);i++){const x=r()*w,y=r()*h*.88,rad=.5+r()*2.2;circle(ctx,x,y,rad*(.85+.15*Math.cos(u+i)),i%7===0?p[2]:p[3]);}
  for(let j=0;j<5;j++){const x=r()*w,y=r()*h,rad=8+r()*40;circle(ctx,x,y,rad,p[j%3]);circle(ctx,x-rad*.25,y-rad*.28,rad*.44,p[1]);}
 } else if(['mountain','sunset','forest','snow','rain'].includes(theme)){
  circle(ctx,w*.75,h*.27,h*.11,p[3]);
  for(let m=0;m<3;m++){const base=h*(.52+m*.19),amp=h*(.13+m*.05),n=7;
   fill(ctx,p[(m+1)%3]);ctx.beginPath();ctx.moveTo(0,h);for(let i=0;i<=n;i++)ctx.lineTo(i*w/n,base-(r()-.2)*amp);ctx.lineTo(w,h);ctx.closePath();ctx.fill();}
  if(theme==='forest'){for(let i=0;i<Math.round(55*density);i++){const x=r()*w,y=h*(.56+r()*.48),size=6+r()*h*.12;line(ctx,x,y,x,y-size,2,p[2]);for(let k=0;k<3;k++)circle(ctx,x,y-size*(.9-k*.16),size*(.18+k*.06),k%2?p[1]:p[2]);}}
  if(theme==='snow'||theme==='rain'){for(let i=0;i<Math.round(155*density);i++){const x=(r()*w+(theme==='snow'?Math.sin(u)*14:t*32))%w,y=(r()*h+t*(theme==='snow'?12:67))%h;if(theme==='rain')line(ctx,x,y,x-2,y+11,1,p[3]);else circle(ctx,x,y,1+r()*2,p[2]);}}
 } else if(theme==='sea'){
  circle(ctx,w*.7,h*.23,h*.13,p[3]);fill(ctx,p[1]);ctx.fillRect(0,h*.51,w,h*.49);
  for(let j=0;j<16;j++){const y=h*(.53+j*.032),phase=j*.73+u*.6;ctx.strokeStyle=j%2===0?p[2]:p[3];ctx.lineWidth=1+j*.04;ctx.beginPath();for(let x=0;x<=w;x+=4){const yy=y+Math.sin(x*.036+phase)*h*.009;if(x===0)ctx.moveTo(x,yy);else ctx.lineTo(x,yy);}ctx.stroke();}
 } else if(theme==='city'){
  circle(ctx,w*.79,h*.21,h*.11,p[3]);fill(ctx,p[1]);ctx.fillRect(0,h*.8,w,h*.2);
  for(let x=0;x<w;){const bw=10+r()*43,bh=h*(.17+r()*.58),y=h*.8-bh;fill(ctx,p[2]);ctx.fillRect(x,y,bw,bh);fill(ctx,p[3]);for(let wy=y+9;wy<y+bh-5;wy+=12)for(let wx=x+5;wx<x+bw-4;wx+=10)if(r()>.36)ctx.fillRect(wx,wy,3,4);x+=bw+2;}
 } else if(theme==='flowers'){
  for(let i=0;i<Math.round(42*density);i++){const x=r()*w,y=h*(.24+r()*.71),rad=3+r()*17;line(ctx,x,y+rad*3,x,y,1.5,p[1]);for(let j=0;j<7;j++){const a=j*2*Math.PI/7+u*.04;circle(ctx,x+Math.cos(a)*rad*.72,y+Math.sin(a)*rad*.72,rad*.5,i%3?p[2]:p[3]);}circle(ctx,x,y,rad*.4,p[3]);}
 } else {
  for(let i=0;i<Math.round(115*density);i++){const x=r()*w,y=r()*h,rad=4+r()*h*.16,phase=u*(i%4?1:-1);circle(ctx,x+Math.sin(phase+i)*4,y+Math.cos(phase)*3,rad,p[1+i%3]);}
 }
 return {theme,width:w,height:h,seed};
}
export function audioSpec(raw={}){
 const kind=String(raw.kind??'ambient');if(!['ambient','waves','wind','tones','robot'].includes(kind))throw Error('音声種別が不正です');
 const seconds=Number(raw.seconds??4),seed=Number(raw.seed??2026),pitch=Number(raw.pitch??1);
 if(!Number.isFinite(seconds)||seconds<.5||seconds>MEDIA_LIMITS.duration||!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isFinite(pitch)||pitch<.2||pitch>3)throw Error('音声時間・シードが範囲外です');
 return {kind,seconds,seed,pitch,text:String(raw.text??'こんにちは').slice(0,200),sampleRate:MEDIA_LIMITS.sampleRate};
}
const vowelMap={あ:'a',い:'i',う:'u',え:'e',お:'o',か:'a',き:'i',く:'u',け:'e',こ:'o',さ:'a',し:'i',す:'u',せ:'e',そ:'o',た:'a',ち:'i',つ:'u',て:'e',と:'o',な:'a',に:'i',ぬ:'u',ね:'e',の:'o',は:'a',ひ:'i',ふ:'u',へ:'e',ほ:'o',ま:'a',み:'i',む:'u',め:'e',も:'o',や:'a',ゆ:'u',よ:'o',ら:'a',り:'i',る:'u',れ:'e',ろ:'o',わ:'a',を:'o',ん:'n',ア:'a',イ:'i',ウ:'u',エ:'e',オ:'o',カ:'a',キ:'i',ク:'u',ケ:'e',コ:'o'};
const fTable={a:[790,1250],i:[300,2300],u:[350,1250],e:[550,1850],o:[480,930],n:[260,1100]};
export function synthSamples(raw){
 const s=audioSpec(raw),rate=s.sampleRate,count=Math.round(rate*s.seconds),data=new Float32Array(count),random=seeded(s.seed);let filter=0;
 const kana=[...s.text].filter(x=>vowelMap[x]);
 for(let i=0;i<count;i++){
  const t=i/rate,fade=Math.min(1,t/.06,(s.seconds-t)/.12),noise=(random()-.5)*2;
  let v=0;
  if(s.kind==='ambient'){filter=filter*.76+noise*.24;v=filter*.36+Math.sin(2*Math.PI*110*s.pitch*t)*.10;}
  if(s.kind==='wind'){filter=filter*.97+noise*.03;v=filter*.68;}
  if(s.kind==='waves'){filter=filter*.94+noise*.06;v=filter*(.1+.9*Math.pow(Math.sin(t*1.8),2))*.85+Math.sin(2*Math.PI*75*s.pitch*t)*.03;}
  if(s.kind==='tones'){const n=[0,2,4,7,9,7,4,2][Math.floor(t*4)%8],hz=220*s.pitch*Math.pow(2,n/12),env=Math.exp(-(t*4%1)*2.8);v=(Math.sin(2*Math.PI*hz*t)+.23*Math.sin(2*Math.PI*2*hz*t))*env*.27;}
  if(s.kind==='robot'){
   const segments=Math.max(1,kana.length),idx=Math.min(segments-1,Math.floor(t/s.seconds*segments)),seg=(t/s.seconds*segments)%1;
   const vowel=vowelMap[kana[idx]]||'a',[f1,f2]=fTable[vowel],f0=(120+8*Math.sin(t*1.7))*s.pitch;let sum=0;
   for(let k=1;k<=25;k++){const fq=f0*k,amp=Math.exp(-(((fq-f1)/125)**2))*.9+Math.exp(-(((fq-f2)/170)**2))*.55;sum+=Math.sin(2*Math.PI*fq*t)*amp;}
   const syllable=Math.min(1,seg*12,(1-seg)*12);v=(sum*.22+noise*(seg<.08?.08:0))*syllable;
  }
  data[i]=Math.max(-1,Math.min(1,v*Math.max(0,fade)));
 }
 return {samples:data,rate};
}
export function wavBytes(raw){const {samples,rate}=synthSamples(raw);const b=new Uint8Array(44+samples.length*2),v=new DataView(b.buffer);const put=(off,s)=>{for(let i=0;i<s.length;i++)b[off+i]=s.charCodeAt(i);};put(0,'RIFF');v.setUint32(4,b.length-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);return b;}
/** Fixed 256 RGB332 colour table (deterministic, no model). */
function gifPalette(){const p=new Uint8Array(256*3);for(let i=0;i<256;i++){p[i*3]=Math.round(((i>>5)&7)*255/7);p[i*3+1]=Math.round(((i>>2)&7)*255/7);p[i*3+2]=Math.round((i&3)*255/3);}return p;}
export function rgbaToIndex(rgba,w,h){if(!rgba||rgba.length!==w*h*4)throw Error('RGBA長が一致しません');const o=new Uint8Array(w*h);for(let i=0;i<o.length;i++){o[i]=((rgba[i*4]>>5)<<5)|((rgba[i*4+1]>>5)<<2)|(rgba[i*4+2]>>6);}return o;}
function gifLzw(pixels){const clear=256,end=257,dict=new Map();let next=258,width=9,acc=0,bits=0,output=[];
 const put=c=>{acc|=c<<bits;bits+=width;while(bits>=8){output.push(acc&255);acc>>>=8;bits-=8;}};
 const reset=()=>{dict.clear();next=258;width=9;};reset();put(clear);
 if(!pixels.length){put(end);}else{let prefix=pixels[0];for(let i=1;i<pixels.length;i++){
  const c=pixels[i],key=prefix*256+c,found=dict.get(key);
  if(found!==undefined){prefix=found;continue;}
  put(prefix);
  if(next<4096){dict.set(key,next++);if(next>(1<<width)&&width<12)width++;}
  else{put(clear);reset();}
  prefix=c;
 }put(prefix);put(end);}
 if(bits)output.push(acc&255);
 const blocks=[];for(let i=0;i<output.length;i+=255){const chunk=output.slice(i,i+255);blocks.push(chunk.length,...chunk);}blocks.push(0);return blocks;
}
/** Encode GIF89a animation; pixels are palette indices for each frame. */
export function gifBytes(frames,w,h,fps=8){
 if(!Array.isArray(frames)||frames.length<2||frames.length>MEDIA_LIMITS.frames||!Number.isInteger(fps)||fps<2||fps>20||frames.length/fps>MEDIA_LIMITS.duration||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>MEDIA_LIMITS.videoWidth||h>MEDIA_LIMITS.videoHeight)throw Error('GIF制限超過');
 const out=[],byte=n=>out.push(n&255),word=n=>{byte(n);byte(n>>8);},str=s=>{for(let i=0;i<s.length;i++)byte(s.charCodeAt(i));};
 str('GIF89a');word(w);word(h);byte(0xf7);byte(0);byte(0);out.push(...gifPalette());
 // Netscape infinite loop
 out.push(0x21,0xff,11);str('NETSCAPE2.0');out.push(3,1,0,0,0);
 for(const frame of frames){if(!(frame instanceof Uint8Array)||frame.length!==w*h)throw Error('GIF画像データ長が不正です');
  const delay=Math.max(1,Math.round(100/fps));out.push(0x21,0xf9,4,4,delay&255,delay>>8,0,0,0x2c);word(0);word(0);word(w);word(h);byte(0);byte(8);for(const n of gifLzw(frame))out.push(n);}
 byte(0x3b);return Uint8Array.from(out);
}
let crcTable;
export function crc32(data){if(!crcTable){crcTable=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c>>>0;}}let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
/** Noncompressed ZIP so it works without APIs or internet. Caller must enforce asset limits. */
export function zipBytes(entries){if(!Array.isArray(entries)||!entries.length||entries.length>MEDIA_LIMITS.assets+3)throw Error('ZIPエントリ数不正');let size=0;const parts=[],index=[],used=new Set();const u16=n=>[n&255,(n>>>8)&255],u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];let offset=0;
 for(const entry of entries){const name=String(entry.name||''),filename=enc.encode(name),buf=entry.bytes instanceof Uint8Array?entry.bytes:enc.encode(String(entry.bytes??''));
  if(!/^[a-zA-Z0-9_./-]{1,120}$/.test(name)||name.startsWith('/')||name.includes('..')||name.includes('//'))throw Error('ZIPパス不正');
  if(used.has(name))throw Error('ZIP同名ファイルは追加できません');used.add(name);
  size+=buf.length;if(size>MEDIA_LIMITS.projectBytes)throw Error('ZIP総量を超過');const crc=crc32(buf);
  const local=Uint8Array.from([...u32(0x04034b50),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(buf.length),...u32(buf.length),...u16(filename.length),...u16(0)]);
  parts.push(local,filename,buf);const central=Uint8Array.from([...u32(0x02014b50),...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(buf.length),...u32(buf.length),...u16(filename.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]);index.push(central,filename);offset+=local.length+filename.length+buf.length;
 }
 const cdsize=index.reduce((s,b)=>s+b.length,0),end=Uint8Array.from([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(cdsize),...u32(offset),...u16(0)]),result=new Uint8Array(offset+cdsize+end.length);let pos=0;for(const part of [...parts,...index,end]){result.set(part,pos);pos+=part.length;}return result;
}
/** Import ZIPs produced by Sol-Zero's store writer only. Reject compressed data,
 * encrypted/data-descriptor archives and path traversal rather than guessing. */
export function unzipStored(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MEDIA_LIMITS.projectBytes+100_000)throw Error('ZIP容量または形式が不正です');
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u16=o=>d.getUint16(o,true),u32=o=>d.getUint32(o,true),eocd=bytes.length-22;
 if(u32(eocd)!==0x06054b50||u16(eocd+4)!==0||u16(eocd+6)!==0||
   u16(eocd+8)!==u16(eocd+10)||u16(eocd+20)!==0)throw Error('ZIP終端またはディスク構成が不正です');
 const count=u16(eocd+10),dirSize=u32(eocd+12),dirOffset=u32(eocd+16);
 if(!count||count>MEDIA_LIMITS.assets+3||dirOffset>eocd||dirOffset+dirSize!==eocd)
  throw Error('ZIP中央ディレクトリの個数・長さが不正です');
 const files=[],names=new Set(),decoder=new TextDecoder('utf-8',{fatal:true});
 let dir=dirOffset,dataCursor=0,total=0;
 for(let i=0;i<count;i++){
  if(dir+46>eocd||u32(dir)!==0x02014b50)throw Error('ZIP中央エントリ破損');
  const flags=u16(dir+8),method=u16(dir+10),crc=u32(dir+16),packed=u32(dir+20),
        original=u32(dir+24),nlen=u16(dir+28),extra=u16(dir+30),
        comment=u16(dir+32),disk=u16(dir+34),local=u32(dir+42);
  if(flags!==0x0800||method!==0||packed!==original||extra||comment||disk||
     !nlen||nlen>120||dir+46+nlen>eocd)
   throw Error('ZIPは自己生成した非圧縮UTF-8形式のみ対応です');
  const nameBytes=bytes.subarray(dir+46,dir+46+nlen),name=decoder.decode(nameBytes);
  if(!/^[a-zA-Z0-9_./-]{1,120}$/.test(name)||name.startsWith('/')||
     name.includes('..')||name.includes('//')||names.has(name))
   throw Error('ZIPパスまたは重複が不正です');
  names.add(name);
  if(local!==dataCursor||local+30>dirOffset||u32(local)!==0x04034b50||
     u16(local+6)!==flags||u16(local+8)!==method||u32(local+14)!==crc||
     u32(local+18)!==packed||u32(local+22)!==original||
     u16(local+26)!==nlen||u16(local+28)!==0)
   throw Error('ZIPローカルヘッダーと中央索引が不一致です');
  const nameStart=local+30,begin=nameStart+nlen,finish=begin+packed;
  if(finish>dirOffset)throw Error('ZIPファイル境界が不正です');
  for(let n=0;n<nlen;n++)if(bytes[nameStart+n]!==nameBytes[n])
   throw Error('ZIP内の素材名が一致しません');
  total+=packed;if(total>MEDIA_LIMITS.projectBytes)throw Error('ZIP展開量の上限超過');
  const payload=bytes.slice(begin,finish);
  if(crc32(payload)!==crc)throw Error('ZIP CRC不一致');
  files.push({name,bytes:payload});
  dataCursor=finish;dir+=46+nlen;
 }
 if(dir!==eocd||dataCursor!==dirOffset)throw Error('ZIP索引とデータの境界が不一致です');
 return files;
}

/** WSP directly programs 4x3 media-control weights; not a learned generator. */
export class MediaWSP{
 constructor(){this.weights=[[.5,.1,.1],[.4,.25,-.1],[.15,0,0],[.2,.15,.2]];this.history=[];}
 group(theme){if(theme==='space')return 0;if(theme==='sea'||theme==='sunset')return 1;if(['mountain','forest','flowers','snow','rain'].includes(theme))return 2;return 3;}
 controls(theme){const row=this.weights[this.group(theme)];return {density:Math.max(.2,Math.min(2.5,1+row[0])),motion:Math.max(.2,Math.min(2.5,1+row[1])),pitch:Math.max(.2,Math.min(2.5,1+row[2]))};}
 edit(row,col,value){if(!Number.isInteger(row)||row<0||row>3||!Number.isInteger(col)||col<0||col>2||!Number.isFinite(value)||Math.abs(value)>1.5)throw Error('WSP重み範囲外');this.history.push({row,col,old:this.weights[row][col]});if(this.history.length>40)this.history.shift();this.weights[row][col]=value;}
 rollback(){const v=this.history.pop();if(!v)return false;this.weights[v.row][v.col]=v.old;return true;}
 snapshot(){return {version:1,weights:this.weights.map(x=>[...x])};}
 restore(s){if(!s||s.version!==1||!Array.isArray(s.weights)||s.weights.length!==4||!s.weights.every(x=>Array.isArray(x)&&x.length===3&&x.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1.5)))return false;this.weights=s.weights.map(x=>[...x]);this.history=[];return true;}
}
