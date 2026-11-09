import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCapabilityCases, parseCapabilityArgs, evaluateOneCapability
} from '../tools/compare_model_capabilities.mjs';

test('model comparison includes six bounded, unique public test prompts', async () => {
  const cases=await loadCapabilityCases();
  assert.ok(cases.length>=6);
  assert.equal(new Set(cases.map(x=>x.id)).size,cases.length);
  assert.ok(cases.some(c=>c.id==='code'));
  assert.ok(cases.some(c=>c.id==='translation'));
  assert.ok(cases.some(c=>c.id==='arithmetic'));
  assert.ok(cases.every(c=>!/\b(?:api_key|password|secret)\b/i.test(c.prompt)));
});

test('model comparison requires case-specific explicit consent and loopback route', () => {
  const endpoint='--endpoint=http://127.0.0.1:9932/v1/chat/completions';
  assert.throws(()=>parseCapabilityArgs([endpoint,'--model=sol0-kimi','--case=arithmetic']),/consent/);
  assert.throws(()=>parseCapabilityArgs(['--consent',endpoint,'--model=sol0-kimi']),/one --case/);
  assert.throws(()=>parseCapabilityArgs(['--consent',endpoint,'--model=sol0-kimi','--case=code','--case=translation']),/one --case/);
  assert.throws(()=>parseCapabilityArgs(['--consent','--endpoint=http://example.com/v1/chat/completions','--model=kimi','--case=code']),/127/);
  assert.equal(parseCapabilityArgs(['--consent',endpoint,'--model=sol0-kimi','--case=arithmetic']).caseId,'arithmetic');
});

test('one capability call cannot execute code and preserves unreviewed status', async () => {
  const opts=parseCapabilityArgs([
    '--consent','--endpoint=http://127.0.0.1:9932/v1/chat/completions',
    '--model=sol0-kimi','--case=arithmetic'
  ]);
  let body;
  const fetchImpl=async (_url,config)=>{
    body=JSON.parse(config.body);
    return {
      ok:true,headers:new Headers(),
      body:null,
      text:async()=>JSON.stringify({choices:[{message:{content:'323'}}]})
    };
  };
  const result=await evaluateOneCapability(opts,{fetchImpl});
  assert.equal(body.messages.length,1);
  assert.equal(body.messages[0].role,'user');
  assert.match(body.messages[0].content,/17×19/);
  assert.equal(result.exactMatch,true);
  assert.equal(result.reviewStatus,'unreviewed');
  assert.equal(result.response,'323');
  await assert.rejects(evaluateOneCapability({...opts,caseId:'does_not_exist'},{fetchImpl}),/Unknown/);
});

test('capability comparison does not label human-review tasks as automatic success', async () => {
  const opts=parseCapabilityArgs([
    '--consent','--endpoint=http://127.0.0.1:9932/v1/chat/completions',
    '--model=sol0-kimi','--case=translation'
  ]);
  const fake=async()=>({
    ok:true,headers:new Headers(),body:null,
    text:async()=>JSON.stringify({choices:[{message:{content:'会議は火曜日まで延期されました。'}}]})
  });
  const result=await evaluateOneCapability(opts,{fetchImpl:fake});
  assert.equal(result.exactMatch,null);
  assert.equal(result.reviewStatus,'unreviewed');
});

test('an empty Qwen answer is reported as failed quality, not a fake passing reply',async()=>{
  const opts=parseCapabilityArgs([
    '--consent','--endpoint=http://127.0.0.1:9931/v1/chat/completions',
    '--model=sol0-qwen','--case=translation'
  ]);
  const empty=async()=>({
    ok:true,headers:new Headers(),body:null,
    text:async()=>JSON.stringify({choices:[{message:{content:''}}]})
  });
  const result=await evaluateOneCapability(opts,{fetchImpl:empty});
  assert.equal(result.outcome,'empty-response');
  assert.equal(result.response,'');
  assert.equal(result.exactMatch,null);
  assert.equal(result.reviewStatus,'needs-review');
  const exact=await evaluateOneCapability({...opts,caseId:'arithmetic'},{fetchImpl:empty});
  assert.equal(exact.exactMatch,false);
});

test('a real connection or HTTP failure still fails the capability evaluation',async()=>{
  const opts=parseCapabilityArgs([
    '--consent','--endpoint=http://127.0.0.1:9931/v1/chat/completions',
    '--model=sol0-qwen','--case=translation'
  ]);
  const unavailable=async()=>({ok:false,status:503,headers:new Headers()});
  await assert.rejects(evaluateOneCapability(opts,{fetchImpl:unavailable}),
    /Model server rejected/);
  const broken=async()=>{throw new TypeError('connection refused');};
  await assert.rejects(evaluateOneCapability(opts,{fetchImpl:broken}),/connection refused/);
});
