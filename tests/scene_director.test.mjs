import test from 'node:test';
import assert from 'node:assert/strict';
import {planImageScene,renderDirectedDetails} from '../chat_web/scene_director.js';
import {renderMediaScene,validateMediaSpec,MEDIA_LIMITS,gifBytes} from '../chat_web/media_studio.js';

const recipe={
 prompt:'左に赤い猫、右に青いロボット、夕焼けの海、水彩',
 seed:2026,width:512,height:288,frames:24,fps:8
};

function tracedContext({nativeEllipse=true}={}){
 const calls=[];
 const saved=[];
 const ctx={
  fillStyle:'',strokeStyle:'',lineWidth:1,globalAlpha:1,
  beginPath(){calls.push('begin')},
  fill(){calls.push('fill:'+this.fillStyle)},
  stroke(){calls.push('stroke:'+this.strokeStyle)},
  rect(x,y,w,h){calls.push(['rect',x,y,w,h])},
  arc(x,y,r){calls.push(['arc',x,y,r])},
  fillRect(x,y,w,h){calls.push(['fillRect',x,y,w,h,typeof this.fillStyle==='string'?this.fillStyle:'gradient'])},
  moveTo(x,y){calls.push(['move',x,y])},
  lineTo(x,y){calls.push(['line',x,y])},
  closePath(){calls.push('close')},
  save(){saved.push({alpha:this.globalAlpha});calls.push('save')},
  restore(){const last=saved.pop();this.globalAlpha=last.alpha;calls.push('restore')},
  createLinearGradient(){return {addColorStop(){}}},
  ...(nativeEllipse?{ellipse(x,y,rx,ry){calls.push(['ellipse',x,y,rx,ry]);}}:{})
 };
 return {ctx,calls};
}

test('compound Japanese scene prompt parses distinct subject, placement, color, atmosphere and style',()=>{
 const plan=planImageScene(recipe.prompt,{seed:recipe.seed,width:512,height:288,theme:'sea'});
 assert.equal(plan.version,1);
 assert.equal(plan.engine,'deterministic offline scene director (not generative ML)');
 assert.equal(plan.style,'watercolor');
 assert.equal(plan.lighting,'golden');
 assert.equal(plan.subjects.length,2);
 assert.equal(plan.subjects[0].kind,'cat');
 assert.equal(plan.subjects[0].position,'left');
 assert.equal(plan.subjects[0].color,'#d95255');
 assert.ok(plan.subjects[0].x<.4);
 assert.equal(plan.subjects[1].kind,'robot');
 assert.equal(plan.subjects[1].position,'right');
 assert.equal(plan.subjects[1].color,'#488bc1');
 assert.ok(plan.subjects[1].x>.6);
 assert.ok(Object.isFrozen(plan.subjects));
 assert.ok(Object.isFrozen(plan.subjects[0]));
});

test('English prompts, mood, front-back depth, night and ink styles are recognized locally',()=>{
 const plan=planImageScene(
   'a purple robot on the left, a green tree on the right, calm night neon',
   {seed:9,theme:'forest'}
 );
 assert.equal(plan.lighting,'night');
 assert.equal(plan.style,'neon');
 assert.equal(plan.mood,'calm');
 assert.deepEqual(plan.subjects.map(x=>x.kind),['robot','tree']);
 assert.equal(plan.subjects[0].position,'left');
 assert.equal(plan.subjects[0].color,'#a788ce');
 assert.equal(plan.subjects[1].position,'right');
 assert.equal(plan.subjects[1].color,'#6ca48a');
 const natural=planImageScene('遠くに小鳥、手前に猫、モノクロの森',
   {seed:11,theme:'forest'});
 assert.equal(natural.style,'ink');
 assert.equal(natural.subjects[0].depth,'far');
 assert.equal(natural.subjects[1].depth,'near');
 assert.ok(natural.subjects[0].scale<natural.subjects[1].scale);
});

test('composition is deterministic, subject count is bounded and missing subjects are safe',()=>{
 const a=planImageScene(recipe.prompt,{seed:77,theme:'sea'});
 const b=planImageScene(recipe.prompt,{seed:77,theme:'sea'});
 const c=planImageScene(recipe.prompt,{seed:78,theme:'sea'});
 assert.deepEqual(a,b);
 assert.notDeepEqual(a.subjects,c.subjects);
 const many=planImageScene('猫犬船家鳥人物車木花雲月太陽'.repeat(10),{seed:1});
 assert.equal(many.subjects.length,10);
 const empty=planImageScene('抽象的な光と色、青空',{seed:1});
 assert.equal(empty.subjects.length,0);
 assert.equal(empty.hasComposedSubjects,false);
 assert.throws(()=>planImageScene('cat',{width:2048}),/範囲/);
 assert.throws(()=>planImageScene('cat',{seed:-1}),/範囲/);
 assert.throws(()=>planImageScene('cat',{height:0}),/範囲/);
});

test('real render path adds foreground actors to the existing deterministic theme renderer',()=>{
 const a=tracedContext(),b=tracedContext();
 const out1=renderMediaScene(a.ctx,recipe,0);
 const out2=renderMediaScene(b.ctx,recipe,0);
 assert.deepEqual(a.calls,b.calls);
 assert.equal(out1.theme,'sea');
 assert.equal(out1.composition.subjects,2);
 assert.equal(out1.composition.style,'watercolor');
 assert.ok(a.calls.some(c=>Array.isArray(c)&&c[0]==='ellipse'));
 assert.ok(a.calls.some(c=>Array.isArray(c)&&c[0]==='fillRect'));
 assert.ok(a.calls.length>500);
 assert.equal(a.calls.at(-1),'restore');
 assert.deepEqual(out1,out2);
 const atOtherFrame=tracedContext();
 renderMediaScene(atOtherFrame.ctx,recipe,.5);
 assert.notDeepEqual(a.calls,atOtherFrame.calls);
});

test('fallback Canvas2D path works on Android-like minimal drawing mocks',()=>{
 const {ctx,calls}=tracedContext({nativeEllipse:false});
 delete ctx.save;
 delete ctx.restore;
 const spec=validateMediaSpec({...recipe,controls:{density:.5,motion:1,pitch:1}});
 const out=renderMediaScene(ctx,spec,0);
 assert.equal(out.composition.subjects,2);
 assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='arc'));
 assert.equal(ctx.globalAlpha,1);
});

test('all supported scene actors and styles render without external resources',()=>{
 const subjects='猫 犬 ロボット 船 家 鳥 人物 車 木 花 雲 月 太陽';
 const specs=[
  {theme:'space',prompt:'宇宙の'+subjects+'、ネオン'},
  {theme:'mountain',prompt:'山の'+subjects+'、線画'},
  {theme:'flowers',prompt:'森の'+subjects+'、ピクセル'},
  {theme:'city',prompt:'街の'+subjects+'、水彩'}
 ];
 for(const spec of specs){
  const {ctx,calls}=tracedContext();
  const result=renderMediaScene(ctx,{...recipe,...spec},0);
  assert.equal(result.composition.subjects,10);
  assert.ok(calls.length>300);
  assert.ok(calls.length<16000);
  assert.equal(ctx.globalAlpha,1);
 }
});

test('GIF eight-second cap, PNG dimensions, offline limits and WSP control boundaries remain intact',()=>{
 const spec=validateMediaSpec({...recipe,width:1024,height:1024,
   frames:60,fps:8,controls:{density:2.5,motion:2.5,pitch:.2}});
 assert.equal(spec.frames/spec.fps,7.5);
 assert.equal(MEDIA_LIMITS.duration,8);
 assert.throws(()=>validateMediaSpec({...recipe,frames:60,fps:6}),/フレーム/);
 const pixels=new Uint8Array(16*16);
 assert.throws(()=>gifBytes(Array.from({length:60},()=>pixels),16,16,6),/制限/);
});
