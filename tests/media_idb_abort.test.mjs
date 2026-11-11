import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual function body without loading browser-only media UI.
const source=readFileSync(new URL('../chat_web/media_ui.js',import.meta.url),'utf8');
const start=source.indexOf('async function replaceAssetsTransaction(assets){');
const end=source.indexOf('\nexport class MediaStudio',start);
assert.ok(start>=0&&end>start,'replacement function must be present');
const fnSource=source.slice(start,end);

function harness({failPut=false,failPutAt=null,failAbort=false}={}){
 const old=[{id:'existing',bytes:[1,2,3]}];
 let persisted=structuredClone(old),working,aborts=0,closed=0,commits=0,puts=0;
 const tx={
  oncomplete:null,onabort:null,
  objectStore(){return {
   clear(){working=[];},
   put(asset){if(failPut||++puts===failPutAt)throw new Error('injected synchronous put error');working.push(asset);}
  };},
  abort(){aborts++;if(failAbort)throw new Error('abort failed');working=null;queueMicrotask(()=>tx.onabort?.());}
 };
 const db={
  transaction(){working=structuredClone(persisted);return tx;},
  close(){closed++;}
 };
 const context={studioDB:async()=>db,queueMicrotask};
 const replace=vm.runInNewContext(fnSource+'\nreplaceAssetsTransaction',context);
 async function run(assets){
  const result=replace(assets);
  // Cross the event-loop turn so the VM async function has created its transaction.
  // A single Promise.resolve() races with its nested await continuation.
  await new Promise(resolve=>setImmediate(resolve));
  // Simulate IndexedDB's asynchronous commit if the transaction was not aborted.
  queueMicrotask(()=>{if(working!==null){persisted=structuredClone(working);commits++;tx.oncomplete?.();}});
  return await result;
 }
 return {run,get persisted(){return persisted;},get aborts(){return aborts;},get closed(){return closed;},get commits(){return commits;}};
}

test('synchronous put exception aborts clear and preserves existing assets',async()=>{
 const h=harness({failPut:true});
 assert.equal(await h.run([{id:'replacement'}]),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.persisted,[{id:'existing',bytes:[1,2,3]}]);
 assert.equal(h.aborts,1);
 assert.equal(h.commits,0);
 assert.equal(h.closed,1);
});

test('second put exception rolls back queued clear and first put',async()=>{
 const h=harness({failPutAt:2});
 assert.equal(await h.run([{id:'first'},{id:'second'}]),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.persisted,[{id:'existing',bytes:[1,2,3]}]);
 assert.equal(h.aborts,1);
 assert.equal(h.commits,0);
 assert.equal(h.closed,1);
});

test('successful replacement commits the new assets',async()=>{
 const h=harness();
 assert.equal(await h.run([{id:'replacement'}]),true);
 assert.deepEqual(h.persisted,[{id:'replacement'}]);
 assert.equal(h.aborts,0);
 assert.equal(h.commits,1);
 assert.equal(h.closed,1);
});

test('abort throwing still reports failure and closes the database',async()=>{
 const h=harness({failPut:true,failAbort:true});
 assert.equal(await h.run([{id:'replacement'}]),false);
 assert.equal(h.aborts,1);
 assert.equal(h.closed,1);
});
