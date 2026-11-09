import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SolZeroEngine} from '../chat_web/engine.js';
import {ScratchBigram} from '../chat_web/bigram.js';
import {WSPBulk} from '../chat_web/wsp_bulk.js';
import {WSPFlow} from '../chat_web/wsp_flow.js';
import {WSPGraph,inspectGraph} from '../chat_web/wsp_graph.js';

const source=readFileSync(new URL('../chat_web/app.js',import.meta.url),'utf8');
const start=source.indexOf('function schemaRead(raw){');
const end=source.indexOf('\nfunction notify(',start);
assert.ok(start>=0&&end>start,'schemaRead must be present');
const limits=source.match(/^const MAX_CHATS=.*;$/m)?.[0];
const assistantLimit=source.match(/^const MAX_ASSISTANT_MESSAGE_CHARS=.*;$/m)?.[0];
assert.ok(limits&&assistantLimit,'schema limits must be declared');
const schemaRead=vm.runInNewContext(limits+'\n'+assistantLimit+'\n'+source.slice(start,end)+'\nschemaRead',{}, {timeout:1000});
const encode=(messages,schema=3)=>JSON.stringify({schema,current:'chat-1',chats:[{id:'chat-1',title:'WSP export',messages}]});
const msg=(role,text)=>({role,text,at:'2026-11-09T00:00:00Z'});

test('long assistant WSP exports survive JSON restoration',()=>{
 const code='def wsp_predict(inputs):\n'+'    # validated generated code\n'.repeat(450);
 assert.ok(code.length>3200);
 const restored=schemaRead(encode([msg('user','/exportwsp python'),msg('assistant',code)]));
 assert.equal(restored.chats[0].messages[1].text,code);
});

test('import bounds retain user cap, assistant cap and overall input guard',()=>{
 const text='x'.repeat(200001);
 const restored=schemaRead(encode([msg('user',text),msg('assistant',text)]));
 assert.equal(restored.chats[0].messages[0].text.length,3200);
 assert.equal(restored.chats[0].messages[1].text.length,200000);
 assert.equal(schemaRead('x'.repeat(4000001)),null);
 assert.equal(schemaRead('{malformed'),null);
});

test('legacy schema 1/2/3 keeps full long assistant message',()=>{
 const code='console.log(1);\n'.repeat(300);
 for(const version of [1,2,3]){
  const restored=schemaRead(encode([msg('assistant',code)],version));
  assert.equal(restored.schema,3);
  assert.equal(restored.chats[0].messages[0].text,code);
 }
});


test('import refuses storage quota failure before replacing live state',async()=>{
 const start=source.indexOf('async function importJson(event){');
 const end=source.indexOf('\nfunction changeTheme(',start);
 assert.ok(start>=0&&end>start);
 const backup=encode([msg('user','incoming')]);
 const previous={schema:3,chats:[{id:'existing',messages:[msg('user','keep me')]}]};
 const notices=[];
 const context={db:previous,DB_KEY:'test-key',schemaRead,confirm:()=>true,
   localStorage:{setItem(){throw Error('QuotaExceededError');}},
   prepareBackupRuntime:()=>({}),notify:(message)=>notices.push(message)};
 const importJson=vm.runInNewContext(source.slice(start,end)+'\nimportJson',context,{timeout:1000});
 const event={target:{files:[{size:backup.length,text:async()=>backup}],value:'selected'}};
 await importJson(event);
 assert.equal(context.db,previous);
 assert.equal(context.db.chats[0].messages[0].text,'keep me');
 assert.match(notices.join(' '),/容量/);
 assert.equal(event.target.value,'');
});

test('invalid imports never replace chat or write storage',async()=>{
 const begin=source.indexOf('async function importJson(event){');
 const finish=source.indexOf('\nfunction changeTheme(',begin);
 assert.ok(begin>=0&&finish>begin);
 const cases=[
  {name:'malformed JSON',body:'{broken',size:7},
  {name:'unsupported schema',body:encode([msg('user','incoming')],99)},
  {name:'missing chats',body:JSON.stringify({schema:3,chats:null})},
  {name:'oversize file',body:encode([msg('user','incoming')]),size:4000001},
  {name:'oversize text',body:'x'.repeat(4000001),size:4000001}
 ];
 for(const entry of cases){
  const original={schema:3,chats:[{id:'existing',messages:[msg('user','keep me')]}],wsp:{marker:'existing'}};
  const writes=[];
  const notices=[];
  const context={db:original,DB_KEY:'test-key',schemaRead,confirm:()=>{throw Error('invalid input must not prompt');},
   localStorage:{setItem(...args){writes.push(args);}},notify:(message)=>notices.push(message)};
  const importJson=vm.runInNewContext(source.slice(begin,finish)+'\nimportJson',context,{timeout:1000});
  const event={target:{files:[{size:entry.size??entry.body.length,text:async()=>entry.body}],value:'selected'}};
  await importJson(event);
  assert.equal(context.db,original,entry.name);
  assert.equal(context.db.chats[0].messages[0].text,'keep me',entry.name);
  assert.equal(context.db.wsp.marker,'existing',entry.name);
  assert.equal(writes.length,0,entry.name);
  assert.ok(notices.length>0,entry.name);
  assert.equal(event.target.value,'',entry.name);
 }
});

const prepStart=source.indexOf('function prepareBackupRuntime(parsed){');
const prepEnd=source.indexOf('\nasync function importJson(event){',prepStart);
assert.ok(prepStart>=0&&prepEnd>prepStart,'atomic staged WSP validator must be defined');
const createRuntime=()=>{
 const engine=new SolZeroEngine();
 engine.bulk=new WSPBulk();
 engine.flow=new WSPFlow();
 engine.graph=new WSPGraph();
 return {engine};
};
function createPreparedHarness(){
 const {engine}=createRuntime();
 const globalContext={engine,WSPBulk,WSPFlow,WSPGraph,ScratchBigram,
   inspectGraph,structuredClone};
 const staged=vm.runInNewContext(source.slice(prepStart,prepEnd)+'\nprepareBackupRuntime',
   globalContext,{timeout:1000});
 return {engine,prepareBackupRuntime:staged};
}
const goodSnapshot=()=>{
 const {engine}=createRuntime();
 return {
   ...JSON.parse(encode([msg('assistant','original imported draft')])),
   wsp:engine.router.snapshot(),
   bulk:engine.bulk.snapshot(),
   flow:engine.flow.snapshot(),
   neural:null,graph:engine.graph.snapshot(),generator:new ScratchBigram().snapshot(),
   graphHistory:[],flowPrevious:null,bulkPrevious:null
 };
};

test('staged import validates a complete valid WSP backup without changing active engines',()=>{
 const {engine,prepareBackupRuntime}=createPreparedHarness();
 const prior=engine.router,previous=JSON.stringify(prior.snapshot());
 const imported=goodSnapshot();
 const prepared=prepareBackupRuntime(imported);
 assert.notEqual(prepared.router,prior);
 assert.deepEqual(prepared.router.snapshot(),imported.wsp);
 assert.equal(JSON.stringify(engine.router.snapshot()),previous);
 assert.ok(prepared.bulk.snapshot());
 assert.equal(prepared.generator.steps,0);
});

test('staged validation rejects every corrupt WSP component before storage write',async()=>{
 const cases=[
  ['router',b=>{b.wsp={weights:[[9999]]};}],
  ['neural',b=>{b.neural={w1:'invalid'};}],
  ['bulk',b=>{b.bulk={rules:null,patches:null};}],
  ['bulk previous',b=>{b.bulkPrevious={rules:null,patches:null};}],
  ['flow',b=>{b.flow={initial:'a',transitions:null};}],
  ['flow previous',b=>{b.flowPrevious={history:[]};}],
  ['graph',b=>{b.graph={nodes:'invalid'};}],
  ['graph history',b=>{b.graphHistory=[{nodes:'invalid'}];}],
  ['graph history type',b=>{b.graphHistory='malformed';}],
  ['generator',b=>{b.generator={version:1,vocab:['x'],weights:[1,2],steps:1};}]
 ];
 for(const [name,damage] of cases){
  const runtime=createPreparedHarness();
  const beforeRouter=runtime.engine.router;
  const beforeWSP=JSON.stringify(runtime.engine.router.snapshot());
  const original=goodSnapshot();
  damage(original);
  assert.throws(()=>runtime.prepareBackupRuntime(original),undefined,name);
  assert.strictEqual(runtime.engine.router,beforeRouter,name);
  assert.equal(JSON.stringify(runtime.engine.router.snapshot()),beforeWSP,name);
  // Exercise actual importJson and assert both memory and persistent storage unchanged.
  const previous={schema:3,chats:[{id:'existing',messages:[msg('user','keep me')]}],wsp:{marker:'existing'}};
  const saved=JSON.stringify(previous);
  let stored=saved,writeCount=0;
  const notices=[];
  const context={
    db:previous,DB_KEY:'test-key',schemaRead,
    prepareBackupRuntime:runtime.prepareBackupRuntime,
    localStorage:{setItem(_key,value){stored=value;writeCount++;}},
    confirm:()=>{throw Error('invalid WSP must not ask for destructive confirmation');},
    notify:message=>notices.push(message)
  };
  const begin=source.indexOf('async function importJson(event){');
  const end=source.indexOf('\nfunction changeTheme(',begin);
  const importJson=vm.runInNewContext(source.slice(begin,end)+'\nimportJson',context,{timeout:1000});
  const text=JSON.stringify(original);
  const event={target:{files:[{size:text.length,text:async()=>text}],value:'selected'}};
  await importJson(event);
  assert.strictEqual(context.db,previous,name);
  assert.equal(stored,saved,name);
  assert.equal(writeCount,0,name);
  assert.equal(event.target.value,'',name);
  assert.match(notices.join(' '),/破損/,name);
 }
});

test('validated import commits storage and live chat once after user approval',async()=>{
 const runtime=createPreparedHarness();
 const sourceBackup=goodSnapshot();
 sourceBackup.chats[0].messages[0].text='imported retained WSP code';
 const original={schema:3,chats:[{id:'existing',messages:[msg('user','keep me')]}]};
 const writes=[],notices=[];
 const stage=runtime.prepareBackupRuntime;
 const generator=new ScratchBigram();
 const context={
  db:original,DB_KEY:'test-key',schemaRead,prepareBackupRuntime:stage,
  engine:runtime.engine,generator,document:{documentElement:{dataset:{}}},
  localStorage:{setItem(_key,value){writes.push(value);}},
  confirm:()=>true,
  byId:()=>({value:''}),draw:()=>{},sidebarClose:()=>{},
  notify:message=>notices.push(message)
 };
 const begin=source.indexOf('async function importJson(event){');
 const end=source.indexOf('\nfunction changeTheme(',begin);
 const importJson=vm.runInNewContext(source.slice(begin,end)+'\nimportJson',context,{timeout:1000});
 const text=JSON.stringify(sourceBackup);
 const event={target:{files:[{size:text.length,text:async()=>text}],value:'selected'}};
 await importJson(event);
 assert.equal(writes.length,1);
 assert.equal(context.db.chats[0].messages[0].text,'imported retained WSP code');
 assert.equal(JSON.stringify(context.engine.router.snapshot()),JSON.stringify(sourceBackup.wsp));
 assert.equal(context.db.graphHistory.length,0);
 assert.match(notices.at(-1),/復元しました/);
 assert.equal(event.target.value,'');
});

test('3.4MB storage boundary refuses valid 3.5MB import without touching chats, docs or WSP',async()=>{
 const runtime=createPreparedHarness();
 const backup=goodSnapshot();
 backup.chats[0].messages=Array.from({length:19},(_,i)=>msg('assistant','L'.repeat(190000)+i));
 const body=JSON.stringify(backup);
 assert.ok(body.length>3400000&&body.length<4000000,body.length);
 const original={schema:3,chats:[{id:'existing',messages:[msg('user','keep me')]}],
  knowledge:[{q:'memory',a:'keep'}],documents:[{title:'media',text:'do not discard'}],
  wsp:{marker:'keep WSP'}};
 const persisted=JSON.stringify(original);
 const notifications=[],writes=[];
 const context={
  db:original,DB_KEY:'test-key',schemaRead,
  prepareBackupRuntime:runtime.prepareBackupRuntime,
  confirm:()=>true,
  localStorage:{setItem(...args){writes.push(args);}},
  notify:m=>notifications.push(m)
 };
 const begin=source.indexOf('async function importJson(event){');
 const end=source.indexOf('\nfunction changeTheme(',begin);
 const importJson=vm.runInNewContext(source.slice(begin,end)+'\nimportJson',context,{timeout:1000});
 const event={target:{files:[{size:body.length,text:async()=>body}],value:'selected'}};
 await importJson(event);
 assert.equal(writes.length,0);
 assert.strictEqual(context.db,original);
 assert.equal(context.db.knowledge[0].a,'keep');
 assert.equal(context.db.documents[0].text,'do not discard');
 assert.equal(context.db.wsp.marker,'keep WSP');
 assert.equal(event.target.value,'');
 assert.match(notifications.join(' '),/容量/);
});
