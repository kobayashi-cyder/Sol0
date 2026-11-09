/**
 * Sol0 scene director v1: offline text-to-scene planning and deterministic
 * multi-layer vector rendering. Procedural art; NO image diffusion / weights.
 * Kept separate from the storage, GIF encoder, WSP and network routes.
 */

const ACTORS=[
 {kind:'robot',re:/ロボット|機械人間|\brobot\b/giu},
 {kind:'cat',re:/猫|ねこ|ネコ|\bcat\b/giu},
 {kind:'dog',re:/犬|いぬ|イヌ|\bdog\b/giu},
 {kind:'boat',re:/帆船|ヨット|船|ボート|\b(?:boat|ship|sailboat)\b/giu},
 {kind:'house',re:/家|小屋|おうち|\b(?:house|cabin|home)\b/giu},
 {kind:'bird',re:/小鳥|鳥|\bbird\b/giu},
 {kind:'person',re:/少女|少年|人物|女性|男性|人間|\b(?:person|girl|boy|human)\b/giu},
 {kind:'car',re:/自動車|車|\bcar\b/giu},
 {kind:'tree',re:/大木|樹木|木|\btree\b/giu},
 {kind:'flower',re:/花|ひまわり|\bflower\b/giu},
 {kind:'cloud',re:/雲|\bcloud\b/giu},
 {kind:'moon',re:/月|\bmoon\b/giu},
 {kind:'sun',re:/太陽|\bsun\b/giu}
];
const COLORS=[
 ['#d95255',/赤い|真紅|赤色|レッド|\bred\b/iu],
 ['#488bc1',/青い|青色|蒼い|ブルー|\bblue\b/iu],
 ['#e1b94e',/黄色|金色|黄色い|黄金|\b(?:yellow|gold)\b/iu],
 ['#6ca48a',/緑色|緑の|グリーン|\bgreen\b/iu],
 ['#a788ce',/紫色|紫の|パープル|\bpurple\b/iu],
 ['#ef9cc8',/ピンク|桃色|\bpink\b/iu],
 ['#e6e7ec',/白色|白い|白の|\bwhite\b/iu],
 ['#343b52',/黒色|黒い|黒の|\bblack\b/iu]
];
const DEFAULTS={
 cat:'#d79362',dog:'#b79579',robot:'#82b4cf',boat:'#e9e2d3',
 house:'#e8b994',bird:'#f1ece4',person:'#9c7bb2',car:'#dc7679',
 tree:'#508671',flower:'#e5a0bd',cloud:'#e8e9f1',moon:'#f7e5b1',sun:'#f7d18d'
};
const ORDER=['cloud','moon','sun','bird','house','tree','car','boat','person','dog','cat','robot','flower'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function random(seed){
 let x=(seed>>>0)||0x6d2b79f5;
 return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};
}
function blend(a,b,ratio){
 if(!/^#[a-f0-9]{6}$/i.test(a)||!/^#[a-f0-9]{6}$/i.test(b))return a;
 const mix=n=>Math.round(parseInt(a.slice(1+n*2,3+n*2),16)*(1-ratio)+
                     parseInt(b.slice(1+n*2,3+n*2),16)*ratio)
                     .toString(16).padStart(2,'0');
 return '#'+mix(0)+mix(1)+mix(2);
}
function colorNear(text,start,end,kind){
 // Prefer a color within the same Japanese noun phrase, not a color from
 // another object somewhere in the prompt.
 const prefix=text.slice(Math.max(0,start-9),start);
 const after=text.slice(end,Math.min(text.length,end+4));
 const local=prefix.split(/[。、，,;；。]/).at(-1)+' '+after;
 for(const [color,re] of COLORS)if(re.test(local))return color;
 return DEFAULTS[kind];
}
function positionNear(text,start,end){
 const before=text.slice(Math.max(0,start-14),start).split(/[。、，,;；]/).at(-1);
 const after=text.slice(end,Math.min(text.length,end+24)).split(/[。、，,;；]/)[0];
 const phrase=before+' '+after;
 if(/左側|左手|左に|左の|left/i.test(phrase))return 'left';
 if(/右側|右手|右に|右の|right/i.test(phrase))return 'right';
 if(/中央|真ん中|中心|center|middle/i.test(phrase))return 'center';
 return 'auto';
}
function depthNear(text,start,end){
 // Context must stop at the clause boundary or the previous object's
 // "遠く" instruction incorrectly leaks into the next "手前" object.
 const before=text.slice(Math.max(0,start-18),start).split(/[。、，,;；]/).at(-1);
 const after=text.slice(end,Math.min(text.length,end+14)).split(/[。、，,;；]/)[0];
 const local=before+' '+after;
 if(/手前|前景|近く|foreground|near/i.test(local))return 'near';
 if(/遠く|遠景|背景|奥に|far|background/i.test(local))return 'far';
 return 'mid';
}
function inferStyle(text){
 if(/水彩|watercolor|水墨|淡彩/i.test(text))return 'watercolor';
 if(/ピクセル|ドット絵|pixel/i.test(text))return 'pixel';
 if(/線画|モノクロ|インク|ink|line art/i.test(text))return 'ink';
 if(/ネオン|サイバー|neon|cyberpunk/i.test(text))return 'neon';
 return 'illustration';
}
function inferLight(text,theme){
 if(/夜|真夜中|夜空|星空|night|midnight/i.test(text))return 'night';
 if(/夕焼|夕日|夕方|sunset|dusk|golden hour/i.test(text))return 'golden';
 if(/朝|日の出|morning|sunrise/i.test(text))return 'morning';
 return theme==='space'?'night':theme==='sunset'?'golden':'day';
}
function inferMood(text){
 if(/静か|穏やか|calm|serene|peaceful/i.test(text))return 'calm';
 if(/嵐|荒波|激しい|dramatic|storm/i.test(text))return 'dramatic';
 if(/かわいい|可愛い|cute|kawaii/i.test(text))return 'cute';
 return 'normal';
}
/** Convert a bounded prompt into a deterministic, testable scene graph. */
export function planImageScene(prompt,{seed=2026,theme='abstract',width=512,height=288}={}){
 const text=String(prompt??'').slice(0,180);
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||
    !Number.isInteger(width)||width<96||width>1024||
    !Number.isInteger(height)||height<72||height>1024){
   throw Error('画像の構図指定が範囲外です');
 }
 const found=[];
 for(const actor of ACTORS){
   actor.re.lastIndex=0;
   for(const match of text.matchAll(actor.re)){
     if(found.length>=30)break;
     const start=match.index,end=start+match[0].length;
     found.push({kind:actor.kind,start,end,
       position:positionNear(text,start,end),
       depth:depthNear(text,start,end),
       color:colorNear(text,start,end,actor.kind)});
   }
 }
 found.sort((a,b)=>a.start-b.start||ORDER.indexOf(a.kind)-ORDER.indexOf(b.kind));
 const selected=found.slice(0,10);
 const rng=random(seed);
 const n=selected.length;
 const actors=selected.map((a,i)=>{
   const natural=n===1?.50:(i+1)/(n+1);
   const jitter=(rng()-.5)*.055;
   const x=a.position==='left'?.22:a.position==='right'?.78:
           a.position==='center'?.50:clamp(natural+jitter,.1,.9);
   const y=(a.kind==='sun'||a.kind==='moon'||a.kind==='cloud'||a.kind==='bird')
     ?.17+(rng()-.5)*.10:
     a.kind==='boat'?.65:(a.depth==='far'?.60:a.depth==='near'?.82:.74);
   const scale=(a.depth==='far'?.58:a.depth==='near'?1.27:1)*(.89+rng()*.17);
   return Object.freeze({kind:a.kind,x,y:clamp(y,.1,.92),scale,
     position:a.position,depth:a.depth,color:a.color});
 });
 return Object.freeze({
   version:1,prompt:text,seed,theme,width,height,
   style:inferStyle(text),lighting:inferLight(text,theme),mood:inferMood(text),
   subjects:Object.freeze(actors),
   hasComposedSubjects:actors.length>0,
   engine:'deterministic offline scene director (not generative ML)'
 });
}
function rect(ctx,x,y,w,h,color){
 ctx.fillStyle=color;ctx.fillRect(x,y,Math.max(.1,w),Math.max(.1,h));
}
function oval(ctx,x,y,rx,ry,color){
 ctx.fillStyle=color;ctx.beginPath();
 if(typeof ctx.ellipse==='function')ctx.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),0,0,Math.PI*2);
 else ctx.arc(x,y,Math.max(.1,Math.min(rx,ry)),0,Math.PI*2);
 ctx.fill();
}
function poly(ctx,coords,color){
 ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(coords[0][0],coords[0][1]);
 for(let i=1;i<coords.length;i++)ctx.lineTo(coords[i][0],coords[i][1]);
 ctx.closePath();ctx.fill();
}
function stroke(ctx,pts,color,width=1){
 ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
 ctx.moveTo(pts[0][0],pts[0][1]);
 for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);
 ctx.stroke();
}
function star(ctx,x,y,size,color){
 const p=[];for(let i=0;i<10;i++){
   const a=i*Math.PI/5-Math.PI/2,rad=i%2?size*.4:size;
   p.push([x+Math.cos(a)*rad,y+Math.sin(a)*rad]);
 }poly(ctx,p,color);
}
function petals(ctx,x,y,r,color){
 for(let i=0;i<7;i++){
   const a=i*Math.PI*2/7;
   oval(ctx,x+Math.cos(a)*r*.73,y+Math.sin(a)*r*.73,r*.51,r*.41,color);
 }
 oval(ctx,x,y,r*.32,r*.32,'#e8c566');
}
function drawActor(ctx,a,w,h,time,style){
 const x=a.x*w,y=a.y*h,sz=clamp(Math.min(w,h)*.15*a.scale,9,175);
 const c=style==='ink'?'#e3e3de':a.color;
 const dark=style==='ink'?'#202632':blend(c,'#17273e',.37);
 const pale=blend(c,'#ffffff',.45);
 const black=style==='neon'?'#162641':'#212739';
 const wiggle=Math.sin(time*2.3+a.x*5)*sz*.035;
 const k=a.kind;
 if(k==='sun'||k==='moon'){
   for(let radius=1.7;radius>=1.15;radius-=.27)oval(ctx,x,y,sz*radius,sz*radius,
     blend(c,'#ffffff',.5*(radius-1)));
   oval(ctx,x,y,sz,sz,c);
   if(k==='moon')oval(ctx,x+sz*.38,y-sz*.20,sz*.86,sz*.93,'#303a60');
   return;
 }
 if(k==='cloud'){
   oval(ctx,x,y,sz*1.6,sz*.44,blend(c,'#f7f8fb',.36));
   oval(ctx,x-sz*.75,y-sz*.12,sz*.79,sz*.62,c);
   oval(ctx,x+sz*.18,y-sz*.48,sz*.9,sz*.83,pale);
   oval(ctx,x+sz*.92,y-sz*.12,sz*.63,sz*.5,c);
   return;
 }
 if(k==='bird'){
   stroke(ctx,[[x-sz,y],[x-sz*.4,y-sz*.35-wiggle],[x,y],[x+sz*.4,y-sz*.35-wiggle],[x+sz,y]],c,Math.max(2,sz*.15));
   oval(ctx,x,y+sz*.1,sz*.14,sz*.12,dark);
   return;
 }
 if(k==='flower'){
   stroke(ctx,[[x,y+sz*1.4],[x+wiggle,y]],'#53886b',Math.max(2,sz*.13));
   poly(ctx,[[x,y+sz*.55],[x-sz*.7,y+sz*.36],[x-sz*.28,y+sz*.85]],'#649f78');
   petals(ctx,x+wiggle,y,sz,c);return;
 }
 if(k==='tree'){
   poly(ctx,[[x-sz*.17,y+sz*1.5],[x-sz*.13,y],[x+sz*.12,y],[x+sz*.2,y+sz*1.5]],'#77594e');
   for(let i=0;i<3;i++){
     const yy=y-sz*(.65-i*.42),r=sz*(.70+i*.22);
     poly(ctx,[[x,yy-sz*.9],[x-r,yy+sz*.3],[x+r,yy+sz*.3]],i%2?c:dark);
   }
   return;
 }
 if(k==='house'){
   rect(ctx,x-sz,y-sz*.25,sz*2,sz*1.36,c);
   poly(ctx,[[x-sz*1.18,y-sz*.25],[x,y-sz*1.25],[x+sz*1.18,y-sz*.25]],dark);
   rect(ctx,x-sz*.22,y+sz*.35,sz*.44,sz*.76,dark);
   for(const dx of [-.64,.43]){
     rect(ctx,x+sz*dx,y+sz*.1,sz*.33,sz*.37,pale);
     stroke(ctx,[[x+sz*(dx+.165),y+sz*.1],[x+sz*(dx+.165),y+sz*.47]],dark,1);
   }
   rect(ctx,x+sz*.64,y-sz*.92,sz*.22,sz*.59,dark);
   return;
 }
 if(k==='boat'){
   poly(ctx,[[x-sz*1.3,y],[x+sz*1.3,y],[x+sz*.8,y+sz*.55],[x-sz*.9,y+sz*.55]],dark);
   stroke(ctx,[[x,y-sz*1.65],[x,y+sz*.02]],'#dfe8e9',Math.max(2,sz*.08));
   poly(ctx,[[x-sz*.06,y-sz*1.5],[x-sz*.08,y-sz*.08],[x-sz,y-sz*.12]],c);
   poly(ctx,[[x+sz*.12,y-sz*1.25],[x+sz*.12,y-sz*.16],[x+sz*.77,y-sz*.16]],pale);
   stroke(ctx,[[x-sz*1.4,y+sz*.83],[x-sz*.2,y+sz*.72],[x+sz*1.1,y+sz*.82]],pale,1.8);
   return;
 }
 if(k==='car'){
   rect(ctx,x-sz*1.25,y-sz*.18,sz*2.5,sz*.72,c);
   poly(ctx,[[x-sz*.85,y-sz*.18],[x-sz*.50,y-sz*.87],[x+sz*.43,y-sz*.87],[x+sz*.95,y-sz*.18]],pale);
   rect(ctx,x-sz*.37,y-sz*.7,sz*.7,sz*.42,dark);
   for(const dx of [-.77,.77]){
     oval(ctx,x+sz*dx,y+sz*.55,sz*.27,sz*.27,black);
     oval(ctx,x+sz*dx,y+sz*.55,sz*.11,sz*.11,pale);
   }return;
 }
 if(k==='robot'){
   rect(ctx,x-sz*.77,y-sz*.93,sz*1.54,sz*1.3,c);
   rect(ctx,x-sz*.58,y+sz*.45,sz*1.16,sz*.98,dark);
   for(const dx of [-.37,.37])oval(ctx,x+sz*dx,y-sz*.42,sz*.17,sz*.20,'#d8ffff');
   stroke(ctx,[[x,y-sz*.95],[x,y-sz*1.35]],dark,Math.max(2,sz*.1));
   oval(ctx,x,y-sz*1.38,sz*.13,sz*.13,'#efbd77');
   rect(ctx,x-sz*.22,y+sz*.77,sz*.44,sz*.11,'#93daba');
   for(const dx of [-.73,.73])stroke(ctx,[[x+sz*dx,y+sz*.43],[x+sz*(dx*1.35),y+sz*.8]],c,Math.max(2,sz*.16));
   return;
 }
 if(k==='person'){
   oval(ctx,x,y-sz*.97,sz*.36,sz*.39,pale);
   oval(ctx,x,y-sz*1.18,sz*.4,sz*.2,dark);
   poly(ctx,[[x-sz*.46,y-sz*.52],[x+sz*.46,y-sz*.52],[x+sz*.64,y+sz*.73],[x-sz*.64,y+sz*.73]],c);
   stroke(ctx,[[x-sz*.36,y-sz*.3],[x-sz*.83,y+sz*.4]],pale,Math.max(2,sz*.16));
   stroke(ctx,[[x+sz*.36,y-sz*.3],[x+sz*.83,y+sz*.4]],pale,Math.max(2,sz*.16));
   for(const dx of [-.32,.32])stroke(ctx,[[x+sz*dx,y+sz*.6],[x+sz*dx,y+sz*1.27]],dark,Math.max(2,sz*.2));
   return;
 }
 if(k==='cat'||k==='dog'){
   oval(ctx,x,y+sz*.5,sz*.77,sz*.85,c);
   if(k==='cat'){
     poly(ctx,[[x-sz*.67,y-sz*.66],[x-sz*.53,y-sz*1.53],[x-sz*.10,y-sz*.87]],c);
     poly(ctx,[[x+sz*.67,y-sz*.66],[x+sz*.53,y-sz*1.53],[x+sz*.10,y-sz*.87]],c);
     stroke(ctx,[[x+sz*.55,y+sz*.86],[x+sz*1.18,y+sz*.7],[x+sz*1.25,y+sz*.18]],c,Math.max(3,sz*.15));
   }else{
     oval(ctx,x-sz*.69,y-sz*.56,sz*.32,sz*.68,dark);
     oval(ctx,x+sz*.69,y-sz*.56,sz*.32,sz*.68,dark);
   }
   oval(ctx,x,y-sz*.49,sz*.69,sz*.64,c);
   for(const dx of [-.27,.27])oval(ctx,x+sz*dx,y-sz*.59,sz*.105,sz*.13,black);
   poly(ctx,[[x-sz*.12,y-sz*.29],[x+sz*.12,y-sz*.29],[x,y-sz*.15]],k==='cat'?'#a65a6b':dark);
   if(k==='cat')for(const n of [-1,1]){
     stroke(ctx,[[x+sz*.2*n,y-sz*.22],[x+sz*.78*n,y-sz*.33]],dark,1);
     stroke(ctx,[[x+sz*.2*n,y-sz*.16],[x+sz*.77*n,y-sz*.1]],dark,1);
   }
   for(const dx of [-.45,.45])oval(ctx,x+sz*dx,y+sz*1.25,sz*.23,sz*.15,pale);
 }
}
function backgroundDetails(ctx,scene,rng,time,controls){
 const {width:w,height:h,theme,lighting,style}=scene;
 const density=clamp(Number(controls?.density)||1,.2,2.5);
 const ambience=lighting==='night'?'#c9ccf5':lighting==='golden'?'#ffe4bc':'#ffffff';
 const count=Math.min(180,Math.round(65*density));
 // Fine-grained atmospheric strokes, layered across the whole composition.
 for(let i=0;i<count;i++){
   const x=rng()*w,y=rng()*h,depth=rng();
   if(theme==='space'||lighting==='night'){
     const flicker=.85+.15*Math.sin(time*2+i);
     if(i%13===0)star(ctx,x,y,(1+rng()*2.5)*flicker,ambience);
     else oval(ctx,x,y,Math.max(.4,rng()*1.3),Math.max(.4,rng()*1.3),ambience);
   }else if(theme==='sea'||theme==='sunset'){
     const yy=h*(.52+depth*.45);
     stroke(ctx,[[x,yy],[x+w*(.006+.038*depth),yy]],blend('#e2d6ad',ambience,.35),.6+depth*1.3);
   }else{
     const yy=y*.85;
     stroke(ctx,[[x,yy],[x+2+rng()*12,yy]],blend('#8eabb3',ambience,.42),.5+rng());
   }
 }
 if(theme==='mountain'||theme==='forest'||theme==='snow'||theme==='sunset'){
   // Layered atmospheric ridgelines with parallax before actors.
   for(let layer=0;layer<2;layer++){
     const pts=[[0,h]];
     for(let n=0;n<=10;n++){
       const x=n*w/10,base=h*(.67+layer*.12);
       pts.push([x,base-(rng()-.5)*h*(.075+layer*.09)]);
     }
     pts.push([w,h]);
     poly(ctx,pts,layer===0?'#49687b':'#294c61');
   }
 }
 if(style==='watercolor'){
   // Translucent pigment islands: no network, shader or filter required.
   if(typeof ctx.save==='function')ctx.save();
   ctx.globalAlpha=.10;
   for(let i=0;i<42;i++){
     const x=rng()*w,y=rng()*h,r=Math.min(w,h)*(.02+rng()*.12);
     oval(ctx,x,y,r,r*.72,i%2?'#fff1de':'#a9d9dd');
   }
   if(typeof ctx.restore==='function')ctx.restore();
   else ctx.globalAlpha=1;
 }
 if(style==='pixel'){
   const cell=Math.max(3,Math.floor(Math.min(w,h)/64));
   for(let i=0;i<55;i++){
     const x=Math.floor(rng()*w/cell)*cell,y=Math.floor(rng()*h/cell)*cell;
     rect(ctx,x,y,cell,cell,i%2?'#a5bacc':'#e6d5ac');
   }
 }
}
function foreground(ctx,scene,rng,controls){
 const {width:w,height:h,theme}=scene;
 if(['space','city','sea'].includes(theme))return;
 const n=Math.min(100,Math.round(25*clamp(controls?.density??1,.2,2.5)));
 for(let i=0;i<n;i++){
   const x=rng()*w,y=h*(.86+rng()*.14),len=2+rng()*h*.08;
   stroke(ctx,[[x,y],[x+len*.22,y-len]],'#5c8666',.7+rng()*1.8);
   if(i%7===0)petals(ctx,x+len*.22,y-len,1+rng()*3,'#efc8b4');
 }
}
/** Draw scene graph details on top of the existing offline theme renderer. */
export function renderDirectedDetails(ctx,scene,{time=0,controls={density:1,motion:1}}={}){
 if(!scene||scene.version!==1||!Array.isArray(scene.subjects))throw Error('Invalid directed scene');
 if(!ctx||typeof ctx.beginPath!=='function'||typeof ctx.fillRect!=='function')throw Error('Canvas2D context required');
 const rng=random((scene.seed^0x9e3779b9)>>>0);
 if(typeof ctx.save==='function')ctx.save();
 try{
   backgroundDetails(ctx,scene,rng,time,controls);
   const ordered=[...scene.subjects].sort((a,b)=>
     (a.depth==='far'?0:a.depth==='near'?2:1)-(b.depth==='far'?0:b.depth==='near'?2:1));
   for(const actor of ordered)drawActor(ctx,actor,scene.width,scene.height,
     time*(controls.motion??1),scene.style);
   foreground(ctx,scene,rng,controls);
   if(scene.style==='neon'){
     const ink='#8de1ee';
     stroke(ctx,[[scene.width*.06,scene.height*.92],
       [scene.width*.94,scene.height*.92]],ink,Math.max(1,scene.height*.007));
   }
 }finally{if(typeof ctx.restore==='function')ctx.restore();}
 return {subjects:scene.subjects.length,style:scene.style,lighting:scene.lighting};
}
