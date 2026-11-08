import test from 'node:test';
import assert from 'node:assert/strict';
import {MEDIA_LIMITS,themeOf,validateMediaSpec,seeded,audioSpec,synthSamples,wavBytes,rgbaToIndex,gifBytes,zipBytes,unzipStored,crc32,renderMediaScene,MediaWSP} from '../chat_web/media_studio.js';
const d={prompt:'山',seed:7,width:320,height:180,frames:12,fps:6};
test('scratch drawing recipe is deterministic and bounded',()=>{
 assert.deepEqual(validateMediaSpec(d),validateMediaSpec(d));
 assert.equal(themeOf('青い海'),'sea');assert.equal(themeOf('星空の街'),'space');
 const a=seeded(5),b=seeded(5);for(let i=0;i<50;i++)assert.equal(a(),b());
 assert.throws(()=>validateMediaSpec({...d,width:100000}));assert.throws(()=>validateMediaSpec({...d,frames:1000}));assert.throws(()=>validateMediaSpec({...d,seed:-1}));
});
test('canvas drawing executes real primitives without model calls',()=>{
 const actions=[];const ctx={beginPath(){actions.push('begin')},arc(){actions.push('arc')},fill(){actions.push('fill')},fillRect(){actions.push('rect')},stroke(){actions.push('stroke')},moveTo(){},lineTo(){},closePath(){},createLinearGradient(){return {addColorStop(){}}}};
 for(const prompt of ['宇宙','海','山','森','街','花','雨','雪','夕焼け','抽象'])renderMediaScene(ctx,{...d,prompt,theme:themeOf(prompt)},0);
 assert.ok(actions.length>200);
});
test('WAV has 16-kHz mono PCM header and nonzero samples across five synthesizers',()=>{
 for(const kind of ['ambient','waves','wind','tones','robot']){
  const s={kind,seed:2026,seconds:1.25,text:'こんにちは'};const a=wavBytes(s),b=wavBytes(s);
  assert.deepEqual(a,b);assert.equal(new TextDecoder().decode(a.slice(0,4)),'RIFF');assert.equal(new TextDecoder().decode(a.slice(8,12)),'WAVE');
  const v=new DataView(a.buffer);assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint16(22,true),1);assert.equal(a.length,44+1.25*16000*2);assert.ok(synthSamples(s).samples.some(x=>x!==0));
 }
 assert.throws(()=>audioSpec({seconds:25}));
});
test('fixed palette and GIF89a encode animated frames',()=>{
 const w=32,h=20,rgba=new Uint8Array(w*h*4).fill(255),idx=rgbaToIndex(rgba,w,h);assert.equal(idx.length,w*h);
 const frames=Array.from({length:4},(_,f)=>Uint8Array.from({length:w*h},(_,i)=>(i%256+f)%256));
 const g=gifBytes(frames,w,h,5);assert.equal(new TextDecoder().decode(g.slice(0,6)),'GIF89a');assert.equal(g.at(-1),0x3b);assert.ok(g.length>850);
 assert.throws(()=>gifBytes(frames,999,999,8));assert.throws(()=>rgbaToIndex([1],w,h));
});
test('noncompressed ZIP exports and checks the exact same binary bytes',()=>{
 const payload=new Uint8Array(1000).map((_,i)=>i%251);const z=zipBytes([{name:'assets/sample.wav',bytes:payload},{name:'project.json',bytes:'{"type":"scratch"}'}]);
 const files=unzipStored(z);assert.equal(files.length,2);assert.deepEqual(files[0].bytes,payload);assert.equal(files[1].name,'project.json');assert.equal(crc32(payload),crc32(files[0].bytes));
 assert.throws(()=>zipBytes([{name:'../unsafe.txt',bytes:payload}]));
 const tamper=z.slice(),pos=30+('assets/sample.wav').length;tamper[pos]^=0xff;assert.throws(()=>unzipStored(tamper),/CRC/);
});
test('hard ceilings block memory exhaustion',()=>{
 const entries=Array.from({length:20},(_,i)=>({name:`a${i}.dat`,bytes:new Uint8Array(1)}));assert.throws(()=>zipBytes(entries));
 assert.throws(()=>audioSpec({kind:'MP3',seconds:2}));assert.throws(()=>validateMediaSpec({...d,width:1025}));
});

test('WSP media control matrix directly changes generation and supports rollback',()=>{
 const a=new MediaWSP(),before=a.snapshot(),old=a.controls('sea');a.edit(1,0,.9);assert.ok(a.controls('sea').density>old.density);a.edit(1,2,.5);assert.ok(a.controls('sea').pitch>old.pitch);assert.ok(a.rollback());assert.equal(a.controls('sea').pitch,old.pitch);assert.ok(a.rollback());assert.deepEqual(a.snapshot(),before);assert.throws(()=>a.edit(1,1,Infinity));assert.equal(a.restore({version:1,weights:[[0,0,0],[1],[0,0,0],[0,0,0]]}),false);
});
test('media WSP pitch modifies sound waveform, keeping PCM format',()=>{
 const a=wavBytes({kind:'tones',seconds:.5,pitch:1}),b=wavBytes({kind:'tones',seconds:.5,pitch:1.3});assert.notDeepEqual(a,b);assert.equal(a.length,b.length);
});

test('ZIP refuses directory forgery, appended content and duplicated names',()=>{
 const original=zipBytes([{name:'project.json',bytes:'{"ok":true}'},{name:'assets/a00.png',bytes:new Uint8Array([1,2,3,4,5])}]);
 const eocd=original.length-22,dv=new DataView(original.buffer,original.byteOffset,original.byteLength);
 const central=dv.getUint32(eocd+16,true),broken=at=>{const mutated=original.slice();mutated[at]^=1;assert.throws(()=>unzipStored(mutated));};
 assert.equal(unzipStored(original).length,2);
 for(const at of [central+16,central+42,eocd+12,eocd+8,30])broken(at);
 assert.throws(()=>unzipStored(Uint8Array.from([...original,0])));
 assert.throws(()=>zipBytes([{name:'project.json',bytes:'a'},{name:'project.json',bytes:'b'}]));
 const forged=original.slice();forged[central+9]=0;assert.throws(()=>unzipStored(forged));
});
