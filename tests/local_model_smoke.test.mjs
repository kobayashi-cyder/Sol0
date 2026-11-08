import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseSmokeArgs, runLocalProbe, PROBE_PROMPT } from '../tools/local_model_smoke.mjs';

test('real-model probe requires explicit consent and never accepts remote network targets', () => {
  assert.throws(()=>parseSmokeArgs([]),/consent/);
  assert.throws(()=>parseSmokeArgs(['--endpoint=http://127.0.0.1:1234/v1/chat/completions','--model=hello']),/consent/);
  assert.throws(()=>parseSmokeArgs(['--consent','--endpoint=http://192.168.1.1:1234/v1/chat/completions','--model=hello']),/127/);
  assert.throws(()=>parseSmokeArgs(['--consent','--endpoint=https://example.com/v1/chat/completions','--model=hello']),/127/);
  assert.throws(()=>parseSmokeArgs(['--consent','--endpoint=http://127.0.0.1:1234/v1/embeddings','--model=hello']),/127/);
  assert.throws(()=>parseSmokeArgs(['--consent','--endpoint=http://127.0.0.1:1234/v1/chat/completions','--model=hello','--consent']),/Duplicate/);
});

test('local probe exercises the actual HTTP, OpenAI-compatible parser and response checks', async () => {
  const messages=[];
  const server=createServer(async(req,res)=>{
    const chunks=[];
    for await(const data of req)chunks.push(data);
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    messages.push({url:req.url,method:req.method,body});
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:'接続確認に成功しました。'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const port=server.address().port;
    const opts=parseSmokeArgs([
      '--consent',
      '--endpoint=http://127.0.0.1:'+port+'/v1/chat/completions',
      '--model=sol0-kimi'
    ]);
    const response=await runLocalProbe(opts);
    assert.equal(response.answerLength,'接続確認に成功しました。'.length);
    assert.equal(response.fallback,false);
    assert.equal(messages.length,1);
    assert.equal(messages[0].method,'POST');
    assert.equal(messages[0].url,'/v1/chat/completions');
    assert.equal(messages[0].body.model,'sol0-kimi');
    assert.deepEqual(messages[0].body.messages,[{role:'user',content:PROBE_PROMPT}]);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});

test('local probe rejects malformed or empty model responses', async () => {
  const opts=parseSmokeArgs([
    '--consent','--endpoint=http://127.0.0.1:9967/v1/chat/completions','--model=sol0-qwen'
  ]);
  const fake=async()=>({ok:true,headers:new Headers(),body:null,text:async()=>JSON.stringify({choices:[{message:{content:''}}]})});
  await assert.rejects(runLocalProbe(opts,fake),/empty/);
});
