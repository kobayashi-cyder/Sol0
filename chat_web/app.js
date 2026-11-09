import {SolZeroEngine,ENGINE_VERSION,INTENTS,saveLesson,normalized,calculate} from './engine.js';
import {generateCode} from './code_workshop.js';
import {runTaskPlan,runTaskPlanAsync,validateTaskPlan,TASK_AGENT_DEMO,TASK_AGENT_TOOLS,taskAgentHelp} from './task_agent.js';
import {ScratchBigram} from './bigram.js';
import {WSPBulk,WSP_DEMO_RULES,syntheticRules} from './wsp_bulk.js';
import {WSPFlow,FLOW_DEMO} from './wsp_flow.js';
import {AUTO_DEMO,AUTO_FLOW_DEMO,designAndVerify,validateTask,evaluate,promoteVerified,planFlow} from './wsp_autodesign.js';
import {WSPGraph,inspectGraph,compileTruthTable,denseTemplate,GRAPH_DEMO_XOR,GRAPH_DEMO_NUMERIC,GRAPH_DEMO_PARITY,GRAPH_LIMITS} from './wsp_graph.js';
import {generateWSPCode} from './wsp_codegen.js';
import {INDUCTION_DEMO,induceAndVerify,promoteInduction} from './wsp_induction.js';
import {MediaStudio} from './media_ui.js';
import {FACTORY_FAMILIES,FACTORY_LIMITS,buildFactory,verifyFactory,auditFactory,composeFactories} from './wsp_factory.js';
const engine=new SolZeroEngine();
const generator=new ScratchBigram();
const studio=new MediaStudio();
engine.bulk=new WSPBulk();
engine.flow=new WSPFlow();
engine.graph=new WSPGraph();
const TASK_AGENT_STORE='solzero_task_v015_recipe';
const DB_KEY='solzero_chat_v012_local',V011_KEY='solzero_chat_v011_local',V010_KEY='solzero_chat_v010_local',V09_KEY='solzero_chat_v09_local',V08_KEY='solzero_chat_v08_local',V07_KEY='solzero_chat_v07_local',PREV_KEY='solzero_chat_v06_local',OLD_KEY='solzero_chat_v05_local',OLDER_KEY='solzero_chat_v04_local',ANCIENT_KEY='solzero_chat_v03_local';
const MAX_CHATS=40,MAX_MESSAGES=400,MAX_DOCS=8,MAX_DOC_CHARS=450000;
const MAX_ASSISTANT_MESSAGE_CHARS=200000;
const byId=id=>document.getElementById(id);
const $messages=byId('messages'),$input=byId('input'),$history=byId('history'),$sidebar=byId('sidebar');
let db,priorFocus=null,toastTimer=null;
const el=(tag,props={},...children)=>{
  const node=document.createElement(tag);
  for(const [k,v] of Object.entries(props)) {
    if(v===undefined||v===null)continue;
    if(k==='class')node.className=v;
    else if(k==='text')node.textContent=String(v);
    else if(k==='type'||k==='placeholder'||k==='value'||k==='min'||k==='max'||k==='rows')node[k]=v;
    else if(k==='title'||k==='ariaLabel')node.setAttribute(k==='ariaLabel'?'aria-label':k,v);
    else if(k==='onClick')node.addEventListener('click',v);
    else if(k==='onInput')node.addEventListener('input',v);
  }
  for(const child of children)if(child)node.append(child);
  return node;
};
function id(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now()+'_'+Math.random().toString(16).slice(2);}
function createChat(){return {id:id(),title:'新しい会話',created:new Date().toISOString(),messages:[],notes:[],lessons:[],tasks:[],draft:'',pinned:false};}
function schemaRead(raw){
  try{
    if(typeof raw!=='string'||raw.length>4000000)return null;
    const data=JSON.parse(raw);
    if(!data||![1,2,3].includes(data.schema)||!Array.isArray(data.chats))return null;
    const chats=data.chats.filter(c=>c&&typeof c.id==='string'&&Array.isArray(c.messages)).slice(0,MAX_CHATS).map(c=>({
      id:c.id.slice(0,100),title:String(c.title||'会話').slice(0,80),created:String(c.created||''),
      draft:typeof c.draft==='string'?c.draft.slice(0,3000):'',pinned:c.pinned===true,
      notes:Array.isArray(c.notes)?c.notes.filter(n=>typeof n==='string').slice(-100).map(n=>n.slice(0,500)):[],
      lessons:Array.isArray(c.lessons)?c.lessons.filter(l=>l&&typeof l.q==='string'&&typeof l.a==='string').slice(-100).map(l=>({q:l.q.slice(0,120),a:l.a.slice(0,1500)})):[],
      tasks:Array.isArray(c.tasks)?c.tasks.filter(t=>t&&typeof t.text==='string').slice(-100).map(t=>({text:t.text.slice(0,160),done:!!t.done})):[],
      messages:c.messages.filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.text==='string').slice(-MAX_MESSAGES).map(m=>({role:m.role,text:m.text.slice(0,m.role==='assistant'?MAX_ASSISTANT_MESSAGE_CHARS:3200),at:typeof m.at==='string'?m.at.slice(0,48):''}))
    }));
    if(!chats.length)return null;
    const knowledge=Array.isArray(data.knowledge)?data.knowledge.filter(l=>l&&typeof l.q==='string'&&typeof l.a==='string').slice(-200).map(l=>({q:l.q.slice(0,120),a:l.a.slice(0,1500)})):[];
    const documents=Array.isArray(data.documents)?data.documents.filter(d=>d&&typeof d.text==='string'&&typeof d.title==='string').slice(0,MAX_DOCS).map(d=>({id:String(d.id||id()).slice(0,100),title:d.title.slice(0,100),text:d.text.slice(0,100000),added:typeof d.added==='string'?d.added.slice(0,48):''})):[];
    if(documents.reduce((s,d)=>s+d.text.length,0)>MAX_DOC_CHARS)return null;
    const theme=data.theme==='dark'?'dark':'light';
    return {schema:3,chats,current:chats.some(c=>c.id===data.current)?data.current:chats[0].id,knowledge,documents,theme,wsp:data.wsp||null,bulk:data.bulk||null,bulkPrevious:data.bulkPrevious||null,flow:data.flow||null,generator:data.generator||null,autoAudit:data.autoAudit||null,flowPrevious:data.flowPrevious||null,graph:data.graph||null,graphHistory:data.graphHistory||null,neural:data.neural||null};
  }catch{return null;}
}
function notify(message){const node=byId('toast');node.textContent=message;node.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.add('hidden'),2800);}
function save(){db.neural=engine.neural.snapshot();db.wsp=engine.router.snapshot();db.bulk=engine.bulk.snapshot();db.bulkPrevious=engine.bulk.previous;db.flow=engine.flow.snapshot();db.generator=generator.snapshot();db.graph=engine.graph.snapshot();db.graphHistory=engine.graph.history;try{const payload=JSON.stringify(db);if(payload.length>3400000)throw Error('localStorage上限に近いです');localStorage.setItem(DB_KEY,payload);return true;}catch{notify('保存に失敗しました。容量・ブラウザ設定を確認し、JSONを書き出してください。');return false;}}
function init(){
  let read=null;try{read=schemaRead(localStorage.getItem(DB_KEY));if(!read)read=schemaRead(localStorage.getItem(V011_KEY));if(!read)read=schemaRead(localStorage.getItem(V010_KEY));if(!read)read=schemaRead(localStorage.getItem(V09_KEY));if(!read)read=schemaRead(localStorage.getItem(V08_KEY));if(!read)read=schemaRead(localStorage.getItem(V07_KEY));if(!read)read=schemaRead(localStorage.getItem(PREV_KEY));if(!read)read=schemaRead(localStorage.getItem(OLD_KEY));if(!read)read=schemaRead(localStorage.getItem(OLDER_KEY));if(!read)read=schemaRead(localStorage.getItem(ANCIENT_KEY));}catch{}
  db=read||{schema:3,chats:[createChat()],current:null,knowledge:[],documents:[],theme:'light',wsp:null,bulk:null,bulkPrevious:null,flow:null,generator:null,autoAudit:null,flowPrevious:null,graph:null,graphHistory:null,neural:null};
  db.current ||= db.chats[0].id;
  if(db.wsp)engine.router.restore(db.wsp);
  if(db.neural&&!engine.neural.restore(db.neural))notify('保存されたWSPニューラル重みは不正です。');
  if(db.bulk&&!engine.bulk.restore(db.bulk))notify('WSP一括回路のデータが不正なため復元しませんでした。');
  if(db.bulkPrevious){const old=new WSPBulk();if(old.restore(db.bulkPrevious))engine.bulk.previous=old.snapshot();else notify('旧回路の復元データが不正です。');}
  if(db.flow&&!engine.flow.restore(db.flow))notify('状態機械の保存内容が不正です。');
  if(db.generator)generator.restore(db.generator);
  if(db.graph&&!engine.graph.restore(db.graph))notify('グラフ重みの保存内容が不正です。初期回路を使います。');
  if(Array.isArray(db.graphHistory))engine.graph.history=db.graphHistory.slice(-8).filter(h=>{try{inspectGraph(h);return true;}catch{return false;}});
  engine.autoAudit=db.autoAudit;
  document.documentElement.dataset.theme=db.theme;
  draw();
  studio.ensureLoaded().catch(()=>{});
  if(read)save();
}
function current(){return db.chats.find(c=>c.id===db.current)||db.chats[0];}
function sidebarClose(){$sidebar.classList.remove('open');}
function drawHistory(){
  $history.replaceChildren();
  const query=normalized(byId('historySearch').value);
  const matching=db.chats.filter(c=>!query||normalized(c.title).includes(query)||c.messages.some(m=>normalized(m.text).includes(query))).sort((a,b)=>Number(b.pinned)-Number(a.pinned));
  byId('chatCount').textContent=query?`（${matching.length}/${db.chats.length}）`:`（${db.chats.length}）`;
  for(const c of matching){
    const btn=el('button',{class:'chat-nav',onClick:()=>{db.current=c.id;save();draw();sidebarClose();}});
    btn.setAttribute('aria-current',String(c.id===db.current));
    btn.append(el('span',{text:(c.pinned?'📌 ':'')+c.title}));
    const hit=query?c.messages.find(m=>normalized(m.text).includes(query)):null;
    btn.append(el('small',{text:hit?hit.text.replace(/\s+/g,' ').slice(0,65):`${c.messages.length}件のメッセージ`}));
    $history.append(btn);
  }
  if(!matching.length)$history.append(el('p',{class:'small-caption',text:'一致する会話がありません。'}));
}
function bubble(message){
  const item=el('article',{class:`message ${message.role}`});
  if(message.role==='assistant')item.append(el('div',{class:'avatar',text:'S0'}));
  const content=el('div',{class:'content'}),body=el('div',{class:'bubble',text:message.text});
  const stamp=el('div',{class:'meta'});
  const d=new Date(message.at);
  stamp.append(el('span',{text:Number.isNaN(d.getTime())?'':d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}));
  stamp.append(el('button',{class:'copy-btn',text:'コピー',ariaLabel:'メッセージをコピー',onClick:async()=>{
    try{await navigator.clipboard.writeText(message.text);notify('コピーしました');}catch{notify('この環境ではコピーできません。');}
  }}));
  content.append(body,stamp);item.append(content);return item;
}
function welcome(){
  const box=el('div',{class:'welcome'});
  box.append(el('div',{class:'welcome-logo',text:'S0'}),el('h2',{text:'Sol-Zero へようこそ'}),
    el('p',{text:'既存の学習済みAIを使わず、対話・記憶・登録知識・資料検索を組み立てた実験版です。回答はルールと保存済みデータに基づきます。'}));
  const options=el('div',{class:'examples'});
  for(const example of ['こんにちは','計算して (12+8)/4','/todo 実験結果を確認','/teach 今日の合言葉は？ => あお','/help'])
    options.append(el('button',{class:'example',text:example,onClick:()=>{$input.value=example;resize();$input.focus();}}));
  box.append(options);return box;
}
function drawMessages(){
  $messages.replaceChildren();
  const c=current();
  if(!c.messages.length)$messages.append(welcome());
  else for(const m of c.messages)$messages.append(bubble(m));
  $messages.scrollTop=$messages.scrollHeight;
}
function draw(){drawHistory();drawMessages();$input.value=current().draft||'';resize();byId('pinChat').textContent=current().pinned?'📌 固定を解除':'📌 会話を固定';}
function resize(){$input.style.height='auto';$input.style.height=Math.min(145,$input.scrollHeight)+'px';}
function taskAdapter(allowMediaWrites=false){return {documents:db.documents,graph:engine.graph,neural:engine.neural,cognition:engine.cognition,calculate,generateCode,generateWSPCode,allowMediaWrites,generateMedia:async(kind,opts)=>{await studio.ensureLoaded();return studio.generate(kind,opts);}};}
function taskResultText(r){return (r.ok?'完了':'停止')+'：'+r.trace.length+'工程実行'+(r.ok?'':`。失敗工程：${r.failedAt}（${r.error}）`)+'\n'+JSON.stringify(r.ok?r.output:r.trace,null,2).slice(0,9000)+'\n※計画の実行記録です。自由なAI推論の証明ではありません。';}
async function send(event){
  event?.preventDefault();
  const text=$input.value.trim();if(!text)return;
  const c=current();let answer;
  if(/^\/(?:image|audio|video|gif|webm)(?:\s|$)/i.test(text)){
    const cmd=text.slice(1).split(/\s+/)[0].toLowerCase(),p=text.slice(cmd.length+1).trim();
    try{await studio.ensureLoaded();const kind=cmd==='video'?'gif':cmd;
      const asset=await studio.generate(kind,p?{prompt:p,text:p}:null);
      answer=`${asset.name} を生成しました（${asset.bytes.length.toLocaleString('ja-JP')}バイト）。上部「メディア工房」で再生・保存・一括ZIP出力できます。\n※学習済みモデルではなく手続き的な生成です。`;
    }catch(err){answer='メディア生成エラー：'+err.message;}
  }else if(/^\/agent(?:\s|$)/i.test(text)){
    const input=text.replace(/^\/agent\s*/i,'').trim();
    if(!input||input==='help')answer=taskAgentHelp();
    else if(input==='demo')answer=JSON.stringify(TASK_AGENT_DEMO);
    else if(!input.startsWith('{'))answer='タスクJSONを /agent { ... } として入力するか、上部「タスク工房」を開いてください。/agent demo で例を取得できます。';
    else try{answer=taskResultText(runTaskPlan(input,taskAdapter()));}catch(e){answer='タスク計画を拒否：'+e.message;}
  }else if(/^\/factory(?:\s|$)/i.test(text)){
    try{const args=text.trim().split(/\s+/);
      if(args.length===1||args[1]==='list')answer='WSP回路工房：30種の数値・論理・比較・非線形・統計・ベクトル回路。4bit論理関数65536通り。例 /factory xor2 0 1 0、/factory lut4 13 1 0 1 1。上部の「回路工房」で一括テストできます。';
      else if(args[1]==='audit'){const fam=args[2],start=Number(args[3]??0),count=Number(args[4]??32),r=auditFactory(fam,start,count);answer=`WSP回路検証：${r.family} ${r.passed}/${r.count} 成功、${r.verifiedCases}入力試験。`;}
      else{const fam=args[1],variant=Number(args[2]??0),recipe=buildFactory(fam,variant);
        if(args.length<4)answer=`${recipe.summary}／入力${recipe.graph.inputs.length}本。 /factory ${fam} ${variant} ${recipe.graph.inputs.map(()=>1).join(' ')}`;
        else {const vals=args.slice(3).map(Number),result=new WSPGraph(recipe.graph).run(vals);answer=`${recipe.summary}：${JSON.stringify(result.outputs)}（事前学習なしの決定的回路）`;}}
    }catch(err){answer='WSP工房の入力エラー：'+err.message;}
  }else if(/^\/graph(?:\s|$)/i.test(text)){
    try {const arg=text.replace(/^\/graph\s*/i,'').trim();
      if(!arg||arg==='stats')answer='WSP汎用グラフ：'+JSON.stringify(engine.graph.stats)+'\n使用例：/graph 1,0';
      else {const numbers=arg.split(/[,，\s]+/).map(x=>Number(x));answer='WSPグラフ出力：'+JSON.stringify(engine.graph.run(numbers).outputs);}
    }catch(e){answer='WSPグラフ入力拒否：'+e.message;}
  }else answer=engine.reply(text,c,{knowledge:db.knowledge,documents:db.documents,generator});
  c.messages.push({role:'user',text,at:new Date().toISOString()},{role:'assistant',text:answer,at:new Date().toISOString()});
  if(c.messages.length>MAX_MESSAGES)c.messages.splice(0,c.messages.length-MAX_MESSAGES);
  if(c.title==='新しい会話')c.title=text.replace(/\s+/g,' ').slice(0,36);
  c.draft='';$input.value='';resize();save();draw();$input.focus();
}
function newChat(){const c=createChat();db.chats.unshift(c);if(db.chats.length>MAX_CHATS)db.chats.pop();db.current=c.id;save();draw();$input.value='';resize();sidebarClose();$input.focus();}
function deleteChat(){const c=current();if(c.messages.length && !confirm(`「${c.title}」を削除しますか？ 会話内のメモ・タスク・学習も削除されます。`))return;
  db.chats=db.chats.filter(x=>x.id!==c.id);if(!db.chats.length)db.chats.push(createChat());db.current=db.chats[0].id;save();draw();sidebarClose();notify('会話を削除しました。');}
function togglePin(){const c=current();c.pinned=!c.pinned;save();drawHistory();byId('pinChat').textContent=c.pinned?'📌 固定を解除':'📌 会話を固定';notify(c.pinned?'会話を固定しました':'固定を解除しました');}
function rename(){const c=current(),name=prompt('会話名を入力してください（最大80文字）',c.title);if(name===null)return;
  if(!name.trim())return notify('会話名を入力してください。');c.title=name.trim().slice(0,80);save();drawHistory();sidebarClose();}
function download(content,name,type){const blob=new Blob([content],{type});const href=URL.createObjectURL(blob);const a=el('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),3000);}
function exportJson(){save();download(JSON.stringify({...db,exported_at:new Date().toISOString(),app_version:ENGINE_VERSION},null,2),'solzero_v012_backup.json','application/json;charset=utf-8');sidebarClose();}
function exportMd(){const c=current();const out=[`# ${c.title}`,'','Sol-Zero チャット記録',...c.messages.flatMap(m=>[`## ${m.role==='user'?'ユーザー':'Sol-Zero'}`,'',m.text,''])];download(out.join('\n'),'solzero_chat.md','text/markdown;charset=utf-8');sidebarClose();}
/**
 * Import must be a two-phase commit: validate every optional WSP snapshot in
 * detached objects, then persist. Do not change live engines on invalid data.
 */
function prepareBackupRuntime(parsed){
  const router=new engine.router.constructor();
  if(parsed.wsp && !router.restore(parsed.wsp))throw Error('WSP router');
  const neural=new engine.neural.constructor();
  if(parsed.neural && !neural.restore(parsed.neural))throw Error('WSP neural');
  const bulk=new WSPBulk();
  if(parsed.bulk && !bulk.restore(parsed.bulk))throw Error('WSP bulk');
  if(parsed.bulkPrevious){
    const previous=new WSPBulk();
    if(!previous.restore(parsed.bulkPrevious))throw Error('WSP previous bulk');
    bulk.previous=previous.snapshot();
  }
  const flow=new WSPFlow();
  if(parsed.flow && !flow.restore(parsed.flow))throw Error('WSP flow');
  if(parsed.flowPrevious){
    const previous=new WSPFlow();
    if(!previous.restore(parsed.flowPrevious))throw Error('WSP previous flow');
  }
  const graph=new WSPGraph();
  if(parsed.graph && !graph.restore(parsed.graph))throw Error('WSP graph');
  if(parsed.graphHistory!=null){
    if(!Array.isArray(parsed.graphHistory)||parsed.graphHistory.length>8)throw Error('WSP graph history');
    for(const item of parsed.graphHistory)inspectGraph(item);
    graph.history=parsed.graphHistory.map(item=>structuredClone(item));
  }
  const nextGenerator=new ScratchBigram();
  if(parsed.generator && !nextGenerator.restore(parsed.generator))throw Error('WSP generator');
  return {router,neural,bulk,flow,graph,generator:nextGenerator};
}
async function importJson(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(file.size>4000000)return notify('JSONは4MB以下にしてください。');
  let parsed,prepared;
  try{
    parsed=schemaRead(await file.text());
    if(!parsed)return notify('復元できない形式、または上限超過です。');
    prepared=prepareBackupRuntime(parsed);
  }catch{
    return notify('破損したWSPまたはバックアップのため復元を中止しました。既存データは維持されています。');
  }
  if(!confirm('現在の全会話・知識・資料をバックアップの内容で置き換えます。続けますか？'))return;
  // localStorage may reject quota or disabled storage; do not change any live objects first.
  try{
    const payload=JSON.stringify(parsed);
    if(payload.length>3400000)throw Error('backup exceeds storage limit');
    localStorage.setItem(DB_KEY,payload);
  }catch{
    return notify('保存容量が不足しているため復元を中止しました。既存の会話は維持されています。');
  }
  // There are no validation or storage operations after this commit boundary.
  db=parsed;
  engine.router=prepared.router;
  engine.neural=prepared.neural;
  engine.bulk=prepared.bulk;
  engine.flow=prepared.flow;
  engine.graph=prepared.graph;
  engine.autoAudit=db.autoAudit;
  generator.vocab=prepared.generator.vocab;
  generator.weights=prepared.generator.weights;
  generator.steps=prepared.generator.steps;
  generator.events=prepared.generator.events;
  document.documentElement.dataset.theme=db.theme;
  byId('historySearch').value='';
  draw();
  sidebarClose();
  notify('バックアップを復元しました。');
}
function changeTheme(){db.theme=db.theme==='light'?'dark':'light';document.documentElement.dataset.theme=db.theme;save();sidebarClose();}
function openPanel(which){
  priorFocus=document.activeElement;
  byId('scrim').classList.remove('hidden');byId('panel').classList.remove('hidden');
  byId('panelBody').replaceChildren();
  if(which==='knowledge')renderKnowledge();else if(which==='documents')renderDocuments();else if(which==='circuit')renderCircuit();else if(which==='generator')renderGenerator();else if(which==='bulk')renderBulk();else if(which==='auto')renderAutoDesign();else if(which==='graph')renderGraph();else if(which==='factory')renderFactory();else if(which==='induce')renderInduction();else if(which==='agent')renderTaskAgent();else if(which==='studio'){panelIntro('メディア工房','画像・音声・動画をゼロから生成し、作品ZIPに統合。WSP重みで生成を調整できます。');studio.ensureLoaded().then(()=>{if(!byId('panel').classList.contains('hidden')&&byId('panelTitle').textContent==='メディア工房')studio.render(byId('panelBody'),{notify});}).catch(e=>notify(e.message));}
  byId('closePanel').focus();
}
function closePanel(){byId('panel').classList.add('hidden');byId('scrim').classList.add('hidden');priorFocus?.focus?.();}
function panelIntro(title,subtitle){byId('panelTitle').textContent=title;byId('panelFoot').textContent=subtitle;}
function field(label,type='text',placeholder=''){
  const id='field_'+Math.random().toString(16).slice(2);
  const wrapper=el('div',{class:'field'}),input=el(type==='textarea'?'textarea':'input',{type:type==='textarea'?undefined:type,placeholder});
  input.id=id;const caption=el('label',{text:label});caption.setAttribute('for',id);wrapper.append(caption,input);return {wrapper,input};
}
function renderTaskAgent(){
  panelIntro('タスク工房 v0.15','許可された工程を組み合わせるオフライン実行機構。一般推論AIではありません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'最大16工程・24種類の操作。JSONの前工程を $ref で参照し、CSV集計・資料検索・WSP回路実行・コード生成・手続き的メディア生成を連結できます。未知の操作は拒否します。'}));
  const recipe=field('タスク計画JSON（version=1、steps）','textarea');recipe.input.maxLength=48000;recipe.input.style.minHeight='225px';
  try{recipe.input.value=localStorage.getItem(TASK_AGENT_STORE)||JSON.stringify(TASK_AGENT_DEMO,null,2);}catch{recipe.input.value=JSON.stringify(TASK_AGENT_DEMO,null,2);}
  const status=el('div',{class:'listentry',text:'計画を確認後に実行してください。メディア生成だけは実行前に書込みを確認します。'});
  const templates=[
    ['CSV集計',TASK_AGENT_DEMO],
    ['資料検索',{version:1,steps:[{id:'hits',op:'documents.search',args:{query:'売上'}}]}],
    ['WSP計算とコード変換',{version:1,steps:[{id:'result',op:'wsp.run',args:{input:[1,0]}},{id:'source',op:'wsp.export',args:{language:'python'}}],output:'source'}],
    ['BANC認知計画（実行せず検証）',{version:1,steps:[{id:'preview',op:'cognition.plan',args:{task:{schema:1,facts:{state:'new'},goal:{state:'ready'},actions:[{id:'prepare',tool:'task.value',requires:{state:'new'},effects:{state:'draft'},args:{}},{id:'verify',tool:'task.value',requires:{state:'draft'},effects:{state:'ready'},args:{}}]}}}]}],
    ['学習WSP推論（/net demo後）',{version:1,steps:[{id:'x',op:'value',args:{value:[1.3]}},{id:'guess',op:'wsp.learned',args:{input:{$ref:'x'}}}],output:'guess'}],
    ['画像・音声の生成',{version:1,steps:[{id:'image',op:'media.generate',args:{kind:'image',prompt:'星空'}},{id:'audio',op:'media.generate',args:{kind:'audio',prompt:'波音',text:'波音'}}],output:'audio'}]
  ];
  const choose=document.createElement('select');choose.className='btn';choose.setAttribute('aria-label','タスクの例を選択');for(const [label]of templates){const o=document.createElement('option');o.textContent=label;choose.append(o);}
  choose.addEventListener('change',()=>{recipe.input.value=JSON.stringify(templates[choose.selectedIndex][1],null,2);status.textContent='例を読み込みました。実行はまだしていません。';});
  let last=null;
  const buttons=el('div',{class:'buttons'});
  const btn=(label,fn,primary=false)=>{const b=el('button',{class:primary?'btn primary':'btn',text:label});b.addEventListener('click',fn);buttons.append(b);return b;};
  btn('計画の検証',()=>{try{const p=validateTaskPlan(recipe.input.value);status.textContent='計画の形式と参照関係は有効です。工程数：'+p.steps.length+'\n'+p.steps.map(x=>x.id+': '+x.op).join('\n')+'\n※各工程の実行結果は未検証です。';}catch(e){status.textContent='計画拒否：'+e.message;}});
  const go=btn('計画を実行',async()=>{if(go.disabled)return;go.disabled=true;try{
    const p=validateTaskPlan(recipe.input.value),writes=p.steps.filter(x=>x.op==='media.generate');
    if(writes.length&&!confirm('メディア素材を '+writes.length+' 件生成し、この端末の作品領域に保存します。実行しますか？')){status.textContent='メディア生成を中止しました。';return;}
    status.textContent='現在のタスクを実行しています…';const r=await runTaskPlanAsync(p,taskAdapter(writes.length>0));
    last=r;status.textContent=taskResultText(r);
    try{localStorage.setItem(TASK_AGENT_STORE,recipe.input.value);}catch{status.textContent+='\n※計画の永続保存は利用できません。JSONを保存してください。'}
  }catch(e){status.textContent='計画拒否：'+e.message;}finally{go.disabled=false;}},true);
  btn('計画JSONを保存',()=>{try{const p=validateTaskPlan(recipe.input.value);download(JSON.stringify(p,null,2),'solzero_agent_plan.json','application/json;charset=utf-8');status.textContent='計画JSONを書き出しました。';}catch(e){status.textContent=e.message;}});
  btn('実行記録を保存',()=>{if(!last)return status.textContent='まだ実行記録はありません。';download(JSON.stringify(last,null,2),'solzero_agent_report.json','application/json;charset=utf-8');});
  root.append(choose,recipe.wrapper,buttons,status,el('p',{class:'muted',text:'使える工程：'+TASK_AGENT_TOOLS.join(' / ')}));
}
function renderKnowledge(){
  panelIntro('共有知識を教える','回答は保存したQ&Aの文字列・類似検索です。モデル重みの学習ではありません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:`全会話で使える質問と回答を登録できます。現在 ${db.knowledge.length} 件。類似質問は高い一致度のときのみ回答します。`}));
  const q=field('質問（120文字以内）','text','例：Sol-Zeroの目的は？');q.input.maxLength=120;
  const a=field('回答（1500文字以内）','textarea','例：ゼロから作るローカルAIの実験です。');a.input.maxLength=1500;
  const add=el('button',{class:'btn primary',text:'知識を登録',onClick:()=>{
    try{saveLesson(db.knowledge,q.input.value,a.input.value);save();renderKnowledge();notify('知識を登録しました。');}catch(err){notify(err.message);}
  }});
  root.append(q.wrapper,a.wrapper,el('div',{class:'buttons'},add),el('h3',{text:`登録済みの知識（${db.knowledge.length}件）`}));
  if(!db.knowledge.length)root.append(el('p',{class:'muted',text:'登録済みのQ&Aはありません。上のフォームから追加してください。'}));
  db.knowledge.forEach((item,i)=>{
    const entry=el('div',{class:'listentry'});
    const actions=el('div',{class:'buttons'},el('button',{class:'btn',text:'編集',onClick:()=>{
      const nq=prompt('質問を修正',item.q);if(nq===null||!nq.trim())return;
      const na=prompt('回答を修正',item.a);if(na===null||!na.trim())return;
      if(nq.length>120||na.length>1500)return notify('入力が長すぎます。');
      const conflict=db.knowledge.some((v,j)=>j!==i&&normalized(v.q)===normalized(nq));if(conflict)return notify('同じ質問が別に登録されています。');
      item.q=nq.trim();item.a=na.trim();save();renderKnowledge();
    }}),el('button',{class:'btn danger',text:'削除',onClick:()=>{if(!confirm(`「${item.q}」を削除しますか？`))return;db.knowledge.splice(i,1);save();renderKnowledge();}}));
    entry.append(el('div',{class:'entry-main',text:item.q}),el('div',{class:'entry-answer',text:item.a}),actions);root.append(entry);
  });
}
function renderDocuments(){
  panelIntro('資料を読み込む','対応：.txt / .md（1ファイル150KB以下、最大8件）。端末内に保存し、文字列検索のみ行います。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'登録した資料は「/search 語句」で検索できます。未学習の文章を理解・要約する機能ではありません。'}));
  root.append(el('div',{class:'buttons'},el('button',{class:'btn primary',text:'＋ テキスト資料を追加',onClick:()=>byId('docPicker').click()})));
  root.append(el('h3',{text:`保存資料 ${db.documents.length}/${MAX_DOCS} 件`}));
  for(const [i,doc] of db.documents.entries()){
    const entry=el('div',{class:'listentry'});
    entry.append(el('div',{class:'entry-main',text:doc.title}),el('div',{class:'small-caption',text:`${[...doc.text].length.toLocaleString('ja-JP')}文字・保存先：このブラウザ`}));
    entry.append(el('div',{class:'buttons'},el('button',{class:'btn',text:'検索に使う',onClick:()=>{closePanel();$input.value=`/search `;resize();$input.focus();}}),el('button',{class:'btn danger',text:'削除',onClick:()=>{if(!confirm(`「${doc.title}」を削除しますか？`))return;db.documents.splice(i,1);save();renderDocuments();}})));
    root.append(entry);
  }
  if(!db.documents.length)root.append(el('p',{class:'muted',text:'まだ資料はありません。テキストファイルを追加してください。'}));
}
async function addDocuments(event){
  const files=[...(event.target.files||[])];event.target.value='';let added=0,skipped=0;
  for(const file of files){
    if(db.documents.length>=MAX_DOCS || !/\.(txt|md)$/i.test(file.name)||file.size>150000){skipped++;continue;}
    const content=await file.text();
    if(!content || content.length>100000 || db.documents.reduce((s,d)=>s+d.text.length,0)+content.length>MAX_DOC_CHARS){skipped++;continue;}
    db.documents.push({id:id(),title:file.name.slice(0,100),text:content,added:new Date().toISOString()});added++;
  }
  if(added){save();renderDocuments();}
  notify(`資料追加：${added}件、スキップ：${skipped}件`);
}
function renderCircuit(){
  panelIntro('WSP 重み編集','可逆な小規模分類回路。既存モデル由来の重みはありません。ここでの変更は一般知識の学習ではありません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'入力から特徴量を抽出し、8×8の行列積で応答カテゴリを選択します。直接書き込んだ重みが予測を変えることを検証できます。'}));
  const intent=field('出力カテゴリ'),feature=field('入力特徴'),value=field('設定する重み（−100〜100）','number','例：10');
  function optionize(select){select.replaceChildren();for(const item of INTENTS){const opt=el('option',{text:item});opt.value=item;select.append(opt);}}
  intent.input.replaceWith((()=>{const s=el('select');s.id=intent.input.id;optionize(s);intent.input=s;return s;})());
  feature.input.replaceWith((()=>{const s=el('select');s.id=feature.input.id;optionize(s);feature.input=s;return s;})());
  value.input.min='-100';value.input.max='100';value.input.step='0.1';value.input.value='10';
  const example=field('入力を試す','text','例：ありがとう');example.input.value='ありがとう';
  const output=el('div',{class:'listentry'});
  function test(){const result=engine.router.predict(example.input.value);output.textContent=`検出カテゴリ：${result.intent}\n特徴：${result.features.map((n,i)=>n?INTENTS[i]:null).filter(Boolean).join('、')||'なし'}\nスコア：${result.scores.map((n,i)=>`${INTENTS[i]}=${Number(n.toFixed(2))}`).join(' / ')}`;}
  const action=el('div',{class:'buttons'});
  action.append(el('button',{class:'btn primary',text:'重みを直接設定',onClick:()=>{
    const n=Number(value.input.value);if(!value.input.value.trim()||!Number.isFinite(n))return notify('有限の数値を入力してください。');
    try{engine.router.edit(intent.input.value,feature.input.value,n);save();test();notify('回路の重みを変更しました。');}catch{notify('重みは−100から100の範囲です。');}
  }}),el('button',{class:'btn',text:'前回の変更を取り消す',onClick:()=>{if(!engine.router.rollback())return notify('取り消せる変更はありません。');save();test();notify('変更を戻しました。');}}),el('button',{class:'btn',text:'分類を再計算',onClick:test}));
  root.append(intent.wrapper,feature.wrapper,value.wrapper,example.wrapper,action,output);test();
}
function renderGenerator(){
  panelIntro('生成実験：ゼロから学習','入力文章から文字→次の文字の重みを学習します。意味理解・汎用チャットではありません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'256言語モデル等は使っていません。96種類以下の文字で、1層の確率的文字予測回路を端末内で学習。誤差逆伝播（SGD）により重みを更新します。評価には学習に含めない別の文章を入力してください。'}));
  const train=field('学習文章（8〜10,000文字・最大96種類）','textarea','例：あしたは晴れです。あしたは雨です。');
  const epoch=field('学習回数（1〜20）','number');epoch.input.value='6';epoch.input.min=1;epoch.input.max=20;
  const holdout=field('評価用文章（学習と異なる文章を入力）','textarea','例：あしたは晴れです。');
  const prompt=field('生成の始まり（最後の1文字を使用）','text','例：あ');prompt.input.value='あ';
  const output=el('div',{class:'listentry',text:'文章を学習すると、ここに評価結果が出ます。'});
  function stats(){return `語彙：${generator.size}文字 / 重み：${generator.size*generator.size}個 / 学習更新：${generator.steps.toLocaleString('ja-JP')}回`;}
  const actions=el('div',{class:'buttons'});
  actions.append(el('button',{class:'btn primary',text:'文章から学習する',onClick:()=>{
    try{
      const r=generator.train(train.input.value,Number(epoch.input.value));save();
      output.textContent=`${stats()}\n学習文章の損失：${r.before.loss} → ${r.after.loss}\n※学習文章の損失改善は未知文章の理解を意味しません。`;
      notify('スクラッチ学習が完了しました。');
    }catch(e){notify(e.message);}
  }}));
  actions.append(el('button',{class:'btn',text:'未学習文章で評価',onClick:()=>{
    const r=generator.evaluate(holdout.input.value);
    output.textContent=`${stats()}\n未学習文章の平均損失：${r.loss??'計測不可'}\n語彙内で評価できた割合：${(100*r.coverage).toFixed(1)}%（${r.matched}/${r.pairs}組）\n※学習済み文章を貼れば独立評価ではありません。`;
  }}));
  actions.append(el('button',{class:'btn primary',text:'文字を生成',onClick:()=>{
    try{output.textContent=`${stats()}\n［実験用の1文字予測。事実や文法は保証しません］\n${prompt.input.value}${generator.generate(prompt.input.value,100)}`;}
    catch(e){notify(e.message);}
  }}));
  actions.append(el('button',{class:'btn danger',text:'モデル初期化',onClick:()=>{
    if(!confirm('このブラウザに保存した文字予測モデルの重みを消去しますか？'))return;
    generator.vocab=[];generator.weights=[];generator.steps=0;generator.events=[];save();output.textContent=stats();notify('文字予測モデルを初期化しました。');
  }}));
  const from=field('直接編集：直前の文字','text','例：あ');const to=field('直接編集：次の文字','text','例：し');
  const weight=field('重みの値（−30〜30）','number');weight.input.value='5';weight.input.min='-30';weight.input.max='30';
  const edits=el('div',{class:'buttons'},el('button',{class:'btn',text:'遷移重みを直接変更',onClick:()=>{
    try{generator.edit(from.input.value,to.input.value,Number(weight.input.value));save();output.textContent=stats()+'\n直接編集しました。';notify('重みを変更しました。');}catch(e){notify(e.message);}
  }}),el('button',{class:'btn',text:'直前の編集を戻す',onClick:()=>{if(generator.rollback()){save();notify('編集を戻しました。');}else notify('戻せる編集がありません。');}}));
  root.append(train.wrapper,epoch.wrapper,holdout.wrapper,prompt.wrapper,actions,el('h3',{text:'実験結果'}),output,el('h3',{text:'重み空間を直接編集'}),from.wrapper,to.wrapper,weight.wrapper,edits);
}


function renderBulk(){
  panelIntro('WSP 大量回路コンパイラ','条件を疎なReLU回路へ直接コンパイル。学習済み重みゼロ、ネットワーク通信ゼロ。');
  const root=byId('panelBody');root.replaceChildren();
  const st=el('div',{class:'listentry'}),output=el('div',{class:'listentry'});
  function renderStats(){const v=engine.bulk.stats();st.textContent=`${v.rules.toLocaleString()} ルール / ${v.neurons.toLocaleString()} ニューロン / ${v.features.toLocaleString()} 入力特徴 / ${v.edges.toLocaleString()} 接続\n数値回路：${v.numericBytes.toLocaleString()} B / 保存データ：${v.serializedBytes.toLocaleString()} B / 直接編集：${v.patches}件`;}
  renderStats();root.append(st,el('p',{class:'muted',text:'自然言語AIではありません。入力中の文字列を特徴として抽出し、閾値ニューロンを重み行列で動作させます。4096ルールまでコンパイル可能。'}));
  const ruleText=field('JSONルール配列（書き換え後に「コンパイル」を押す）','textarea','[{"id":"plan","all":["計画","手順"],"not":["中止"],"response":"計画を分割しましょう"}]');
  ruleText.input.style.minHeight='145px';ruleText.input.value=JSON.stringify(engine.bulk.rules,null,2);
  const sample=el('div',{class:'buttons'},
    el('button',{class:'btn primary',text:'JSONを一括コンパイル',onClick:()=>{
      try{if(ruleText.input.value.length>1200000)throw Error('入力は120万文字以内です。');const incoming=JSON.parse(ruleText.input.value);
        const r=engine.bulk.replaceRules(incoming);if(!save())notify('回路は更新されましたが保存できませんでした。');renderStats();output.textContent=`コンパイル成功：${r.rules}ルール、${r.edges}直接指定した数値接続。`;
      }catch(e){output.textContent=`拒否：${e.message}\n元の回路は維持されます。`;}
    }}),
    el('button',{class:'btn',text:'サンプル6ルールを表示',onClick:()=>{ruleText.input.value=JSON.stringify(WSP_DEMO_RULES,null,2);output.textContent='まだ適用していません。コンパイルを押すと既存ルールを置き換えます。';}}),
    el('button',{class:'btn',text:'4,096件の規模試験を生成',onClick:()=>{
      try{const st=engine.bulk.replaceRules(syntheticRules(4096));save();ruleText.input.value='';renderStats();output.textContent=`検証用の合成4,096ルールを数値回路へ変換しました。\n${st.neurons}ニューロン / ${st.edges}接続 / ${st.serializedBytes}バイト。\n「検証キー3871」で発火を調べられます。\n※これは性能・容量の負荷試験で、実用知識や言語能力を増やすものではありません。`;}
      catch(e){output.textContent='規模試験の失敗：'+e.message;}
    }}),
    el('button',{class:'btn',text:'現在の回路を再読込',onClick:()=>{ruleText.input.value=JSON.stringify(engine.bulk.rules,null,2);}}),
    el('button',{class:'btn danger',text:'直前の一括更新を取り消す',onClick:()=>{
      if(engine.bulk.restorePreviousRules()){save();ruleText.input.value=JSON.stringify(engine.bulk.rules,null,2);renderStats();output.textContent='直前の一括更新を取り消しました。';}
      else output.textContent='取り消す変更はありません。';
    }})
  );
  const input=field('回路に入力して検査','text','例：計画の手順を考える');input.input.value='計画の手順を考える';
  const preview=el('button',{class:'btn',text:'ニューロン発火を検査',onClick:()=>{
    const r=engine.bulk.infer(input.input.value,{trace:true});output.textContent=r.match?
      `選択：${r.match.rule}\n応答：${r.match.response}\n発火：\n${r.fired.map(m=>`${m.neuron}: ${m.rule}, activation=${m.activation}, priority=${m.priority}`).join('\n')}`:
      '該当ルールなし。推測して回答しません。';
  }});
  const neuron=field('数値を直接編集するニューロン番号','number','0');neuron.input.value='0';
  const feature=field('接続された特徴量','text','例：計画');
  const weight=field('新しい整数重み -5〜5','number','例：1');weight.input.value='1';
  const edits=el('div',{class:'buttons'},el('button',{class:'btn',text:'接続重みを直接書き込む',onClick:()=>{
    try{const p=engine.bulk.editWeight(Number(neuron.input.value),feature.input.value,Number(weight.input.value));save();renderStats();output.textContent=`直接編集：ニューロン${p.neuron}、${p.feature}、${p.before} → ${p.after}`;}
    catch(e){output.textContent=`編集拒否：${e.message}`;}
  }}),el('button',{class:'btn',text:'重みの編集を1件戻す',onClick:()=>{
    try{output.textContent=engine.bulk.rollbackWeight()?'重みを復元しました。':'復元対象なし。';save();renderStats();}catch(e){output.textContent=`復元拒否：${e.message}`;}
  }}));
  root.append(ruleText.wrapper,sample,input.wrapper,preview,el('h3',{text:'回路の発火検査・結果'}),output,
    el('h3',{text:'重み空間へ直接書き込む'}),neuron.wrapper,feature.wrapper,weight.wrapper,edits);
  appendFlowControls(root);
}


function renderGraph(){
  panelIntro('WSP 汎用グラフ／重み空間','0から設計した数値回路を接続して実行します。学習済みモデルではなく、未訓練の密な行列は知能を持ちません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'入力最大256本・ノード256個・行列重み合計100万個（ブラウザ保護用）。ReLU、行列積、加算、乗算、閾値、シグモイドなどを組み合わせます。既存の文字列WSP・状態機械とは別の拡張回路です。'}));
  const live=el('div',{class:'listentry'}),result=el('div',{class:'listentry',text:'JSON仕様を編集し、検証してから適用できます。'});
  function stats(){const v=engine.graph.stats;live.textContent=`現在の回路：${engine.graph.spec.name}\n${v.inputs}入力 / ${v.nodes}ノード / ${v.weights.toLocaleString('ja-JP')}個の重み・バイアス / 実行演算目安 ${v.operations.toLocaleString('ja-JP')} / 数値重みの32bit理論サイズ ${v.weightBytes.toLocaleString('ja-JP')} B\n直前状態：${engine.graph.history.length}件`;}
  const code=field('回路JSON（入力・レイヤー・活性化・出力）','textarea');code.input.style.minHeight='160px';
  code.input.value=JSON.stringify(engine.graph.snapshot(),null,2);
  const input=field('回路入力（カンマ区切り。例 1,0）','text');input.input.value='1,0';
  const test=field('受入テストJSON（[{"input":[0,0],"expected":[0]}]）','textarea');test.input.value=JSON.stringify([{input:[0,0],expected:[0]},{input:[0,1],expected:[1]},{input:[1,0],expected:[1]},{input:[1,1],expected:[0]}],null,2);
  root.append(live,code.wrapper,input.wrapper,test.wrapper);
  const actions=el('div',{class:'buttons'});
  actions.append(el('button',{class:'btn',text:'XOR回路を表示',onClick:()=>{code.input.value=JSON.stringify(GRAPH_DEMO_XOR,null,2);input.input.value='1,0';result.textContent='XORの6重みを直接指定したサンプルです。未適用。';}}),
    el('button',{class:'btn',text:'数値回路を表示',onClick:()=>{code.input.value=JSON.stringify(GRAPH_DEMO_NUMERIC,null,2);input.input.value='3,2';test.input.value=JSON.stringify([{input:[3,2],expected:[1]},{input:[0,1],expected:[0]}],null,2);result.textContent='線形結合＋ReLUの例です。未適用。';}}),
    el('button',{class:'btn primary',text:'① JSON回路を独立テスト',onClick:()=>{
      try{const spec=JSON.parse(code.input.value),g=new WSPGraph(spec),cases=JSON.parse(test.input.value),r=g.evaluate(cases);
        result.textContent=`設計上の重み：${g.stats.weights.toLocaleString()}個 / 独立テスト：${r.correct}/${r.total}\n${r.rows.filter(x=>!x.passed).slice(0,5).map(x=>JSON.stringify(x)).join('\n')||'すべて成功'}\n※テストデータを設計・調整に流用した場合は独立検証ではありません。`;
      }catch(e){result.textContent='拒否：'+e.message;}
    }}),
    el('button',{class:'btn primary',text:'② 回路を適用',onClick:()=>{
      try{const next=JSON.parse(code.input.value),g=new WSPGraph(next),r=g.evaluate(JSON.parse(test.input.value));
        if(r.correct!==r.total)throw Error(`受入テスト不合格（${r.correct}/${r.total}）`);
        const ok=engine.graph.install(next,true);const saved=save();stats();result.textContent=`${saved?'回路を適用・保存しました':'回路は実行中ですが保存できませんでした'}。${ok.weights.toLocaleString()}個の重み。`;}
      catch(e){result.textContent='回路適用拒否：'+e.message;}
    }}),
    el('button',{class:'btn',text:'現在の回路を実行',onClick:()=>{
      try{const values=input.input.value.split(/[,，\s]+/).map(x=>Number(x));const resultRun=engine.graph.run(values);result.textContent='現在の出力：'+JSON.stringify(resultRun.outputs)+'\n中間値：'+JSON.stringify(resultRun.values).slice(0,1800);}
      catch(e){result.textContent='実行失敗：'+e.message;}
    }}),
    el('button',{class:'btn',text:'回路を元に戻す',onClick:()=>{
      if(!engine.graph.rollback())return result.textContent='戻せる変更はありません。';save();stats();code.input.value=JSON.stringify(engine.graph.snapshot(),null,2);result.textContent='直前の重み空間に戻しました。';
    }}));
  root.append(actions,el('h3',{text:'真理値表からWSP回路を合成'}));
  const truth=field('入力・真理値表JSON','textarea');truth.input.style.minHeight='140px';truth.input.value=JSON.stringify(GRAPH_DEMO_PARITY,null,2);
  root.append(truth.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn primary',text:'真理値表 → 回路生成',onClick:()=>{
      try{const built=compileTruthTable(JSON.parse(truth.input.value));code.input.value=JSON.stringify(built.graph,null,2);
        test.input.value=JSON.stringify(JSON.parse(truth.input.value).rows.map(r=>({input:r.input,expected:Array.isArray(r.output)?r.output:[r.output]})),null,2);
        input.input.value=built.graph.inputs.map(()=>1).join(',');
        result.textContent=`生成しました：${built.stats.nodes}ノード / ${built.stats.weights}重み / 真理値表 ${built.training.correct}/${built.training.total} 正解。${built.complete?'全組合せ指定':'未指定の組合せは0に設定（未知の推論ではありません）'}。\n上の「② 回路を適用」で採用できます。`;
      }catch(e){result.textContent='合成を拒否：'+e.message;}
    }})));
  root.append(el('h3',{text:'密な重み行列を0から生成（未学習）'}));
  const cfg=field('入出力・幅・隠れ層・乱数seed JSON','textarea');cfg.input.value=JSON.stringify({inputs:2,width:32,layers:3,outputs:1,seed:735},null,2);
  root.append(cfg.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn',text:'任意サイズの重みを生成',onClick:()=>{
      try{const spec=denseTemplate(JSON.parse(cfg.input.value)),meta=inspectGraph(spec);code.input.value=JSON.stringify(spec);input.input.value=spec.inputs.map(()=>1).join(',');
        test.input.value=JSON.stringify([{input:spec.inputs.map(()=>1),expected:Array(meta.stats.outputWidths[0]).fill(0)}]);
        result.textContent=`未学習の密行列 ${meta.stats.weights.toLocaleString()} 重みを生成。実際の出力は乱数に依存し、期待値テストを合格するとは限りません。自動採用・自動保存はしません。`;
      }catch(e){result.textContent='生成拒否：'+e.message;}
    }}),el('button',{class:'btn',text:'現在の回路をJSONで出力',onClick:()=>download(JSON.stringify(engine.graph.snapshot()),'solzero_wsp_graph.json','application/json;charset=utf-8')}),
    ...['python','javascript'].map(language=>el('button',{class:'btn',text:language==='python'?'現在の回路→Python':'現在の回路→JavaScript',onClick:()=>{
      try{const compiled=generateWSPCode(engine.graph.snapshot(),language);
        download(compiled.code,compiled.filename,'text/plain;charset=utf-8');
        result.textContent=`数値WSP回路の${compiled.language}コードを出力しました（${compiled.nodes}ノード・${compiled.weights}重み）。コードの実行は端末上で行いません。`;
      }catch(err){result.textContent='コード出力拒否：'+err.message;}
    }}))));
  root.append(el('h3',{text:'重みを指定座標へ直接書き込む'}));
  const target=field('linearノードID','text');target.input.value='hidden';
  const row=field('重みの行番号（0開始）','number');row.input.value='0';
  const col=field('重みの列番号（0開始、−1はバイアス）','number');col.input.value='0';
  const weight=field('新しい重み','number');weight.input.value='1.5';
  root.append(target.wrapper,row.wrapper,col.wrapper,weight.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn primary',text:'数値重みを直接編集',onClick:()=>{
      try{const patch=engine.graph.edit(target.input.value,Number(row.input.value),Number(col.input.value),Number(weight.input.value));save();stats();code.input.value=JSON.stringify(engine.graph.snapshot(),null,2);result.textContent=`編集した重み：${JSON.stringify(patch)}`;}
      catch(e){result.textContent='編集拒否：'+e.message;}
    }})));
  root.append(result);stats();
}

function renderFactory(){
  panelIntro('WSP 回路工房 v0.9','すべて仕様から直接生成する回路です。65,536種の4入力論理関数は選んだものだけ作ります。言語知能の獲得とは異なります。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'30ファミリー：算術・線形写像・論理・比較・非線形・統計・ベクトル・複合演算。各種を指定した条件で重み化し、仕様から計算した期待値と照合します。全65,536回路が常駐しているわけではありません。'}));
  const category=el('div',{class:'listentry',text:`回路の種類 ${FACTORY_FAMILIES.length}／4入力の異なる真理値表 ${FACTORY_LIMITS.distinctBoolean4.toLocaleString('ja-JP')} 種類／一度に検査 ${FACTORY_LIMITS.batch} 回路まで`});
  const selector=document.createElement('select');selector.id='factoryFamily';selector.style.width='100%';
  for(const f of FACTORY_FAMILIES)selector.append(el('option',{value:f.id,text:`${f.category}：${f.label} [${f.id}]`}));
  selector.value='lut4';
  const selectorWrap=el('div',{class:'field'},el('label',{text:'回路ファミリー'}),selector);
  const idx=field('設定番号（LUT4は 0〜65535）','number');idx.input.value='43690';idx.input.min='0';idx.input.max='65535';
  const values=field('入力ベクトル（例：0,1,0,1）','text');values.input.value='0,1,0,1';
  const preview=el('div',{class:'listentry',text:'種類・番号を指定して「回路生成」を押してください。'});
  const tests=el('div',{class:'listentry',text:'照合試験は未実行です。'});
  let staged=null;
  selector.addEventListener('change',()=>{idx.input.value='0';values.input.value=Array.from({length:FACTORY_FAMILIES.find(x=>x.id===selector.value).inputs},()=>1).join(',');staged=null;preview.textContent='種類が変更されました。新しい回路を生成してください。';});
  function fresh(){staged=buildFactory(selector.value,Number(idx.input.value));return staged;}
  root.append(category,selectorWrap,idx.wrapper,values.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn primary',text:'回路生成',onClick:()=>{try{const r=fresh();preview.textContent=`${r.summary}\n${r.graph.inputs.length}入力・${r.stats.nodes}ノード・${r.stats.weights}重み（0から直接コンパイル）\n保存容量は選択した回路だけで増えます。`;tests.textContent='仕様照合の試験を待っています。';}catch(e){staged=null;preview.textContent='生成拒否：'+e.message;}}}),
    el('button',{class:'btn',text:'任意入力で実行',onClick:()=>{try{const r=fresh(),input=values.input.value.trim().split(/[,，\s]+/).map(Number);if(input.some(x=>!Number.isFinite(x)))throw Error('有限な数値が必要です');const output=new WSPGraph(r.graph).run(input).outputs;preview.textContent='実行結果：'+JSON.stringify(output)+'\n予測器ではなく仕様から生成した重み回路の出力です。';}catch(e){preview.textContent='実行拒否：'+e.message;}}}),
    el('button',{class:'btn primary',text:'仕様照合テスト',onClick:()=>{try{const r=fresh(),report=verifyFactory(r);tests.textContent=`${r.label} #${r.variant}：${report.correct}/${report.total} 件正解。${r.exhaustive?'全入力を照合':'有限個の数値例を照合'}。\n※試験の正解は別計算した仕様値です。未知問題への汎化試験ではありません。`;}
      catch(e){tests.textContent='試験拒否：'+e.message;}}}),
    el('button',{class:'btn primary',text:'合格回路をチャットへ適用',onClick:()=>{try{const r=fresh(),report=verifyFactory(r);if(report.correct!==report.total)throw Error('仕様試験に不合格');engine.graph.install(r.graph,true);save();tests.textContent=`${r.label} #${r.variant} を現在の汎用WSPグラフへ適用しました。\n/graph ${r.graph.inputs.map(()=>1).join(',')} で実行できます。汎用WSP画面からロールバックできます。`;}catch(e){tests.textContent='適用拒否：'+e.message;}}}),
    el('button',{class:'btn',text:'JSONを書き出す',onClick:()=>{try{const r=fresh();download(JSON.stringify(r.graph,null,2),`solzero_${r.family}_${r.variant}.json`,'application/json;charset=utf-8');}catch(e){preview.textContent=e.message;}}})
  ),preview,tests);
  root.append(el('h3',{text:'大量生成を実測・検証（逐次生成、保存しない）'}));
  const count=field('一度に検証する回路数（1〜512）','number');count.input.value='128';count.input.min='1';count.input.max='512';
  const bulkLog=el('div',{class:'listentry',text:'各回路を実際にコンパイルして入力値を検証します。結果は常駐させません。'});
  root.append(count.wrapper,el('div',{class:'buttons'},el('button',{class:'btn primary',text:'指定範囲の大量回路を実生成・テスト',onClick:()=>{
    try{const report=auditFactory(selector.value,Number(idx.input.value),Number(count.input.value));bulkLog.textContent=`${report.family} #${report.start}〜${report.start+report.count-1}\n生成・検証：${report.passed}/${report.count} 回路合格／${report.verifiedCases} 入力ケース／仮想重み総数 ${report.virtualWeightCount.toLocaleString('ja-JP')}\n${report.failed?'失敗例: '+JSON.stringify(report.errors):'失敗なし'}\n※検査後、回路は破棄。未検証の設定番号は合格扱いしません。`;
    }catch(e){bulkLog.textContent='一括検証を拒否：'+e.message;}
  }})),bulkLog);
  root.append(el('h3',{text:'異種WSP回路の直列合成'}),el('p',{class:'muted',text:'2〜8段の回路の出力を次の入力に接続します。入出力の数が合わない場合は採用しません。例：一次関数 → ReLU → Sigmoid。'}));
  const pipeline=field('合成する回路の指定（JSON配列）','textarea');pipeline.input.style.minHeight='110px';
  pipeline.input.value=JSON.stringify([{family:'affine1',variant:3},{family:'relu_shift1',variant:4},{family:'sigmoid1',variant:8}],null,2);
  const pipelineLog=el('div',{class:'listentry',text:'合成回路はまだ生成していません。'});let compound=null;
  root.append(pipeline.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn',text:'合成回路を検証',onClick:()=>{try{compound=composeFactories(JSON.parse(pipeline.input.value));pipelineLog.textContent=`直列${compound.stages.length}段：${compound.stats.nodes}ノード／${compound.stats.weights}重み。\n検証：${compound.verification.correct}/${compound.verification.total}（${compound.verified?'合格':'不合格'}）。`; }catch(e){compound=null;pipelineLog.textContent='合成拒否：'+e.message;}}}),
    el('button',{class:'btn primary',text:'合格した合成回路を適用',onClick:()=>{try{compound=composeFactories(JSON.parse(pipeline.input.value));if(!compound.verified)throw Error('仕様照合試験に不合格');engine.graph.install(compound.graph,true);save();pipelineLog.textContent=`異種回路 ${compound.stages.length}段をチャットWSPへ適用しました。/graph に入力して利用できます。`; }catch(e){pipelineLog.textContent='採用拒否：'+e.message;}}})
  ),pipelineLog);
}

function renderAutoDesign(){
  panelIntro('WSP 自動設計・独立検証','入力例から特徴量と数値回路を自動合成します。学習済みLLMは使わず、検証に不合格なら適用できません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'「訓練例」に入力と正解を複数記入します。Sol-Zeroが共有する文字列の特徴を発見してWSP回路を生成し、別の「独立検証例」で正答率と誤発火を評価します。目標文そのものを意味理解することはできません。'}));
  const specText=field('問題の仕様（JSON：train=構築用、validation=独立評価用）','textarea');
  specText.input.style.minHeight='240px';specText.input.value=JSON.stringify(AUTO_DEMO,null,2);
  const result=el('div',{class:'listentry',text:'最初に「自動設計と独立検証」を押してください。'});
  let lastReport=null,lastText=null;
  const overview=()=>{const a=db.autoAudit;if(!a)return 'まだ採用履歴はありません。';return `直近の判定：${a.decision} / 回路 ${a.rules}件 / 検証 ${a.validCorrect}/${a.validTotal} / 目標：${a.goal}`;};
  root.append(el('div',{class:'listentry',text:overview()}),specText.wrapper);
  const action=el('div',{class:'buttons'},
    el('button',{class:'btn',text:'サンプルの問題を読み込む',onClick:()=>{specText.input.value=JSON.stringify(AUTO_DEMO,null,2);lastReport=null;result.textContent='サンプルを編集してから設計してください。';}}),
    el('button',{class:'btn primary',text:'① 自動設計と独立検証',onClick:()=>{
      try{
        if(specText.input.value.length>120000)throw Error('仕様入力は12万文字以内です。');
        const input=JSON.parse(specText.input.value),spec=validateTask(input);
        // A read-only evaluation of the existing circuit. Not used to design the new circuit.
        const baseline=evaluate(engine.bulk,spec.validation);const report=designAndVerify(input);
        lastReport=report;lastText=specText.input.value;
        const errors=report.validation.errors.slice(0,5).map(e=>`・「${e.input}」 期待:${e.expected??'回答なし'} / 実際:${e.actual??'回答なし'}`).join('\n');
        result.textContent=`${report.accepted?'合格（採用可能）':'不合格（採用不可）'}\n目標：${report.goal}\n生成回路：${report.rules.length}ルール、${report.stats.neurons}ニューロン、${report.stats.edges}数値接続\n訓練：${report.training.correct}/${report.training.total} / 独立検証：${report.validation.correct}/${report.validation.total} (${(report.validation.accuracy*100).toFixed(1)}%)\n現行回路：${baseline.correct}/${baseline.total} / 新規誤発火：${report.validation.falsePositive}件\n回路の例：${report.rules.slice(0,8).map(r=>`${r.all.join('&')} → ${r.response}`).join('、')||'なし'}\n${report.reasons.join(' ')}\n${errors}`;
        db.autoAudit={date:new Date().toISOString(),decision:report.accepted?'合格・未適用':'不合格',goal:report.goal.slice(0,180),rules:report.rules.length,validCorrect:report.validation.correct,validTotal:report.validation.total};engine.autoAudit=db.autoAudit;save();
      }catch(e){lastReport=null;lastText=null;result.textContent='設計拒否：'+e.message;}
    }}),
    el('button',{class:'btn primary',text:'② 合格した回路を採用',onClick:()=>{
      if(!lastReport?.accepted || lastText!==specText.input.value){result.textContent='採用不可：最新の仕様に対する合格検証が必要です。';return;}
      if(!confirm(`合格した${lastReport.rules.length}ルールで現在のWSP一括回路を置き換えますか？直前の変更はWSP拡張で戻せます。`))return;
      try{const x=promoteVerified(lastReport,engine.bulk);db.autoAudit={date:new Date().toISOString(),decision:'採用',goal:lastReport.goal.slice(0,180),rules:x.rules,validCorrect:lastReport.validation.correct,validTotal:lastReport.validation.total};engine.autoAudit=db.autoAudit;const ok=save();result.textContent=`${ok?'採用しました':'回路は動作中ですが保存に失敗しました'}：${x.rules}ルール、${x.neurons}ニューロン、${x.edges}接続\nチャットで「/wsp trace 計算して」を試せます。`;lastReport=null;lastText=null;}
      catch(e){result.textContent='採用失敗：'+e.message;}
    }}),
    el('button',{class:'btn',text:'直前のルール採用を戻す',onClick:()=>{
      if(!engine.bulk.restorePreviousRules())return result.textContent='戻せる一括変更はありません。';
      save();result.textContent='WSPルールを直前の構成に戻しました。';lastReport=null;
    }})
  );
  root.append(action,el('h3',{text:'設計・試験結果'}),result,el('h3',{text:'工程から状態遷移回路を自動作成'}),
    el('p',{class:'muted',text:'工程の名前と内容を入力すると、開始・成功・失敗・中止イベントを備えたWSP状態機械を生成します。行動文を返すだけでOS操作はしません。'}));
  const flowInput=field('工程JSON（goalとsteps）','textarea');flowInput.input.style.minHeight='155px';flowInput.input.value=JSON.stringify(AUTO_FLOW_DEMO,null,2);
  const flowResult=el('div',{class:'listentry',text:'工程を入力し「候補を作成」を押してください。'});
  let candidateFlow=null,candidateText=null;
  root.append(flowInput.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn',text:'工程サンプルを読み込む',onClick:()=>{flowInput.input.value=JSON.stringify(AUTO_FLOW_DEMO,null,2);candidateFlow=null;flowResult.textContent='サンプルを読み込みました。';}}),
    el('button',{class:'btn primary',text:'① 遷移回路候補を作成',onClick:()=>{
      try{
        if(flowInput.input.value.length>30000)throw Error('入力が長すぎます。');
        const p=planFlow(JSON.parse(flowInput.input.value)),probe=new WSPFlow(),st=probe.compile(p);
        candidateFlow=p;candidateText=flowInput.input.value;
        flowResult.textContent=`生成候補：${st.states}状態、${st.transitions}遷移、${st.edges}数値接続\n開始：待機 → ${p.transitions[0].to}\n未適用。`;
      }catch(e){candidateFlow=null;flowResult.textContent='生成拒否：'+e.message;}
    }}),
    el('button',{class:'btn primary',text:'② 状態機械へ採用',onClick:()=>{
      if(!candidateFlow||candidateText!==flowInput.input.value)return flowResult.textContent='最新の入力で候補を生成してください。';
      if(!confirm('現在の状態遷移回路と実行履歴を新しい回路へ置き換えますか？'))return;
      try{const old=engine.flow.snapshot(),st=engine.flow.compile(candidateFlow);db.flowPrevious=old;const ok=save();flowResult.textContent=`${ok?'採用しました':'保存に失敗しました'}：${st.states}状態、${st.edges}数値接続。/flow event 開始 で動作を試せます。`;candidateFlow=null;}
      catch(e){flowResult.textContent='拒否：'+e.message;}
    }}),
    el('button',{class:'btn',text:'以前の状態機械に戻す',onClick:()=>{
      if(!db.flowPrevious||!engine.flow.restore(db.flowPrevious))return flowResult.textContent='復元可能な旧状態機械がありません。';
      db.flowPrevious=null;save();flowResult.textContent='以前の状態機械へ戻しました。';
    }})
  ),flowResult);
}

function appendFlowControls(root){
  root.append(el('h3',{text:'WSP状態遷移回路（イベント式）'}),el('p',{class:'muted',text:'状態とイベントの2入力ReLU回路で遷移を決めます。ここでは行動案の文字を返すだけで、端末や外部アプリを勝手に操作しません。'}));
  const current=el('div',{class:'listentry'}),result=el('div',{class:'listentry'});
  const refresh=()=>{const s=engine.flow.stats();current.textContent=`状態：${engine.flow.state} / ${s.states}状態 / ${s.events}イベント / ${s.transitions}遷移 / ${s.edges}重み接続`;};
  refresh();
  const js=field('状態遷移のJSON','textarea','{"initial":"待機","transitions":[]}');js.input.style.minHeight='100px';js.input.value=JSON.stringify(engine.flow.snapshot(),null,2);
  const event=field('遷移イベント名','text','例：開始');event.input.value='開始';
  root.append(current,js.wrapper,event.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn',text:'状態機械サンプルを表示',onClick:()=>{js.input.value=JSON.stringify(FLOW_DEMO,null,2);}}),
    el('button',{class:'btn primary',text:'遷移回路をコンパイル',onClick:()=>{
      try{const spec=JSON.parse(js.input.value);engine.flow.compile(spec);save();refresh();result.textContent='数値状態遷移回路を生成しました。';}
      catch(e){result.textContent='拒否：'+e.message;}
    }}),
    el('button',{class:'btn',text:'イベントを実行（文字だけ）',onClick:()=>{
      const r=engine.flow.step(event.input.value);if(r.matched){save();result.textContent=`${r.before} → ${r.state} （ニューロン${r.neuron}）\n行動案：${r.action}`;}else result.textContent=r.error;
      refresh();
    }}),
    el('button',{class:'btn',text:'前の状態へ戻す',onClick:()=>{
      result.textContent=engine.flow.rewind()?'状態を1つ戻しました。':'戻せません。';save();refresh();
    }})
  ),result);
}


function renderInduction(){
  panelIntro('帰納WSP：数値例から回路を発見','例だけから候補を決め、未使用評価は採用の可否だけに使います。汎用知能ではありません。');
  const root=byId('panelBody');root.replaceChildren();
  root.append(el('p',{class:'muted',text:'1〜3入力の算術・比較・非線形関数や、入力の線形結合を少数の例から推定します。訓練と検証は入力重複禁止。規則が曖昧なら追加の訓練例を求めます。合格しても一般推論の能力を意味しません。'}));
  const spec=field('訓練例と未使用評価例（JSON形式）','textarea');spec.input.style.minHeight='250px';spec.input.value=JSON.stringify(INDUCTION_DEMO,null,2);
  const sample=field('現在の回路に与える入力（例 2,3）','text');sample.input.value='2,3';
  const output=el('div',{class:'listentry',text:'まず「候補回路を合成して検証」を押してください。'});
  let pending=null;
  root.append(spec.wrapper,sample.wrapper,el('div',{class:'buttons'},
    el('button',{class:'btn',text:'サンプルを表示',onClick:()=>{spec.input.value=JSON.stringify(INDUCTION_DEMO,null,2);pending=null;output.textContent='新しい例を読み込みました。まだ回路には適用していません。';}}),
    el('button',{class:'btn primary',text:'① 候補回路を合成して独立検証',onClick:()=>{
      try{const r=induceAndVerify(JSON.parse(spec.input.value));pending=r.accepted?r:null;
        output.textContent=`判定：${r.status}\n${r.reason}\n訓練 ${r.training.correct}/${r.training.total}・未使用評価 ${r.validation.correct}/${r.validation.total}\n合格候補数 ${r.candidates}・選択 ${r.chosen||'なし'}・重み ${r.weights}個`+
          (r.ambiguity?'\n追加例の候補：'+JSON.stringify(r.ambiguity):'')+
          '\n※実証対象は表現可能な少数の数値関数に限定されます。';
      }catch(e){pending=null;output.textContent='回路合成拒否：'+e.message;}
    }}),
    el('button',{class:'btn primary',text:'② 合格回路だけ採用',onClick:()=>{
      try{if(!pending)throw Error('検証済みの候補がありません');
        const result=promoteInduction(pending,engine.graph);pending=null;
        const saved=save();
        output.textContent=`回路を採用しました。${result.weights}個の重み・${result.nodes}ノード。\n${saved?'端末へ保存済み。':'ブラウザ保存失敗。バックアップしてください。'}\n/induce 2,3 でチャットから実行できます。`;
      }catch(e){output.textContent='採用拒否：'+e.message;}
    }}),
    el('button',{class:'btn',text:'現在の回路を実行',onClick:()=>{
      try{const values=sample.input.value.split(/[,，\s]+/).map(Number);const r=engine.graph.run(values);output.textContent='現在の回路出力：'+JSON.stringify(r.outputs)+'\n中間値：'+JSON.stringify(r.values).slice(0,500);}
      catch(e){output.textContent='実行拒否：'+e.message;}
    }}),
    el('button',{class:'btn',text:'採用前の回路へ戻す',onClick:()=>{
      pending=null;
      output.textContent=engine.graph.rollback()?'前の回路へ復元しました。':'復元する履歴はありません。';save();
    }}),
    el('button',{class:'btn',text:'現在の回路JSONを書き出す',onClick:()=>download(JSON.stringify(engine.graph.snapshot(),null,2),'solzero_induced_wsp.json','application/json;charset=utf-8')})
  ),output);
}

byId('pinChat').addEventListener('click',togglePin);
for(const key of ['newSidebar','newTop'])byId(key).addEventListener('click',newChat);
byId('chatForm').addEventListener('submit',send);
$input.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing&&event.keyCode!==229){event.preventDefault();send();}});
$input.addEventListener('input',()=>{current().draft=$input.value.slice(0,3000);save();resize();});
byId('menu').addEventListener('click',()=>$sidebar.classList.toggle('open'));
byId('historySearch').addEventListener('input',drawHistory);
byId('deleteChat').addEventListener('click',deleteChat);
byId('rename').addEventListener('click',rename);
byId('exportJson').addEventListener('click',exportJson);
byId('exportMd').addEventListener('click',exportMd);
byId('importJson').addEventListener('click',()=>byId('jsonPicker').click());
byId('jsonPicker').addEventListener('change',importJson);
byId('themeSide').addEventListener('click',changeTheme);
for(const [btn,section] of [['knowledgeBtn','knowledge'],['docsBtn','documents'],['circuitBtn','circuit'],['generatorBtn','generator'],['bulkBtn','bulk'],['bulkSide','bulk'],['autoBtn','auto'],['autoSide','auto'],['graphBtn','graph'],['graphSide','graph'],['factoryBtn','factory'],['factorySide','factory'],['induceBtn','induce'],['induceSide','induce'],['studioBtn','studio'],['studioSide','studio'],['agentBtn','agent'],['agentSide','agent']])byId(btn).addEventListener('click',()=>openPanel(section));
byId('docPicker').addEventListener('change',addDocuments);
byId('closePanel').addEventListener('click',closePanel);
byId('scrim').addEventListener('click',closePanel);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!byId('panel').classList.contains('hidden'))closePanel();});
init();
