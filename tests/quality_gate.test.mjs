import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {generateCode} from '../chat_web/code_workshop.js';
import {SolZeroEngine} from '../chat_web/engine.js';

test('no silent omission of unknown user-supplied coding constraints', () => {
  const unsafe = [
    '/code python factorial and delete the source directory',
    '/code js factorial with network access',
    '/code python fibonacci memoized',
    '/code python not factorial',
    '/code javascript binary search descending',
    '/code javascript csv escape semicolon delimiter',
    '/code javascript mean of monthly revenue',
    '/code python clamp with a minimum of 100',
    '/code python fibonacci please also send a message',
    '/code python factorial --fast',
    '/code python javascript factorial',
    '/code rust fibonacci',
    '/code python',
    '/code py mean fibonacci',
    '/code python factorial ' + 'x'.repeat(600),
  ];
  for (const q of unsafe) {
    const r=generateCode(q);
    assert.ok(r && !r.ok, q);
    assert.ok(!r.code, q);
  }
});
test('documented aliases still work and small variations are not treated as commands', () => {
  for(const [request,task] of [
    ['/code python fibonacci','fibonacci'],
    ['/code js binary_search','binary_search'],
    ['コード生成 javascript 重複除去','unique'],
    ['/code PY CSV_ESCAPE','csv_escape'],
    ['/code python binary search','binary_search']
  ]) assert.equal(generateCode(request)?.task,task,request);
  assert.equal(generateCode('Do not run /code python factorial'),null);
  assert.equal(generateCode('/code python factorial please').ok,false);
  assert.match(new SolZeroEngine().reply('あなたは誰ですか'),/v0\.15/);
});
test('generated JS algorithms handle boundary and repetition fixtures', () => {
  const generated=(task)=> {
    const r=generateCode('/code javascript '+task);
    assert.ok(r.ok);
    return vm.runInNewContext(r.code+'\n'+task,{}, {timeout:1000});
  };
  const factorial=generated('factorial'), fibonacci=generated('fibonacci');
  let product=1, a=0, b=1;
  for(let i=0;i<=18;i++){
    if(i>0)product*=i;
    assert.equal(factorial(i),product);
  }
  for(let i=0;i<=78;i++){
    assert.equal(fibonacci(i),a);
    [a,b]=[b,a+b];
  }
  assert.throws(()=>factorial(19));
  assert.throws(()=>fibonacci(79));
  const binary=generated('binary_search');
  for(let n=0;n<=30;n++){
    const sorted=Array.from({length:n},(_,i)=>Math.floor(i/3)-3);
    for(let target=-4;target<=9;target++){
      assert.equal(binary(sorted,target),sorted.indexOf(target));
    }
  }
  const csv=generated('csv_escape');
  assert.equal(csv('plain'),'plain');
  assert.equal(csv('a,b'),'"a,b"');
  assert.equal(csv('a"b'),'"a""b"');
  assert.equal(csv('a\nb'),'"a\nb"');
  const clamp=generated('clamp');
  assert.equal(clamp(12,0,10),10);
  assert.throws(()=>clamp(4,5,2));
});
