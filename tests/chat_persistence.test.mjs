import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

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
   notify:(message)=>notices.push(message)};
 const importJson=vm.runInNewContext(source.slice(start,end)+'\\nimportJson',context,{timeout:1000});
 const event={target:{files:[{size:backup.length,text:async()=>backup}],value:'selected'}};
 await importJson(event);
 assert.equal(context.db,previous);
 assert.equal(context.db.chats[0].messages[0].text,'keep me');
 assert.match(notices.join(' '),/容量/);
 assert.equal(event.target.value,'');
});
