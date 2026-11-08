import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {CODE_TASKS,codeHelp,generateCode} from '../chat_web/code_workshop.js';
const queries={factorial:[5,120],fibonacci:[10,55],binary_search:[[1,2,2,3],2,1],unique:[[2,1,2,3,1],[2,1,3]],palindrome:['RaceCar',true],mean:[[2,4,6],4],csv_escape:['a,b','"a,b"'],clamp:[12,0,10,10]};
const expected=(task)=>{const a=queries[task];return a.slice(0,task==='binary_search'?2:task==='clamp'?3:1);};
const result=(task)=>queries[task].at(-1);
for(const task of CODE_TASKS){
 test(`javascript ${task}: generated source executes as expected`,()=>{
   const generated=generateCode(`/code javascript ${task}`);assert.equal(generated.ok,true);
   const context=vm.createContext({});vm.runInContext(generated.code,context,{timeout:1000});
   const args=expected(task);const val=vm.runInContext(`${task}(${args.map(x=>JSON.stringify(x)).join(',')})`,context,{timeout:1000});
   assert.deepEqual(JSON.parse(JSON.stringify(val)),result(task));
   assert.ok(generated.message.includes(generated.code));
 });
 test(`python ${task}: generated source executes as expected`,()=>{
   const generated=generateCode(`/code python ${task}`);assert.equal(generated.ok,true);
   const python=`${generated.code}\nimport json\nprint(json.dumps(${task}(*json.loads(${JSON.stringify(JSON.stringify(expected(task)))}))))`;
   const check=spawnSync('python',['-c',python],{encoding:'utf8',timeout:3000});
   assert.equal(check.status,0,check.stderr);assert.deepEqual(JSON.parse(check.stdout.trim()),result(task));
 });
}
test('invalid, unknown, ambiguous requests are refused without arbitrary code',()=>{
 assert.equal(generateCode('hello'),null);
 for(const q of ['/code','/code rust factorial','/code python javascript mean', '/code js something-unknown', '/code py mean fibonacci']){
  const r=generateCode(q);assert.equal(r.ok,false,q);assert.ok(!r.code,q);
 }
 assert.match(codeHelp(),/二分探索/);
 assert.equal(generateCode('コード生成 javascript 重複除去').task,'unique');
 assert.equal(generateCode('/code js binary_search').task,'binary_search');
});