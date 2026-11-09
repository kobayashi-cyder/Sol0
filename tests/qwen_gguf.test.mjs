import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { parseGGUFMetadata, inspectGGUF, sha256File } from '../tools/gguf_inspect.mjs';
import {
  parseArgs, buildRunnerArgs, launchLocalQwen, startLocalUI, QWEN_ALIAS
} from '../tools/qwen_local.mjs';

const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const str = value => { const b = Buffer.from(value); return Buffer.concat([u64(b.length), b]); };
const textField = (key, val) => Buffer.concat([str(key), u32(8), str(val)]);
const integerField = (key, val) => Buffer.concat([str(key), u32(4), u32(val)]);
const boolField = (key, val) => Buffer.concat([str(key), u32(7), Buffer.from([val ? 1 : 0])]);
const skipTokens = items => Buffer.concat([str('tokenizer.ggml.tokens'),u32(9),u32(8),u64(items.length),...items.map(str)]);

function gguf(architecture = 'qwen3', extra = []) {
  const entries = [
    textField('general.architecture', architecture),
    textField('general.name', 'Qwen synthetic fixture'),
    integerField(architecture + '.block_count', 28),
    integerField(architecture + '.context_length', 32768),
    textField('tokenizer.ggml.model','gpt2'),
    ...extra
  ];
  return Buffer.concat([Buffer.from('GGUF'), u32(3), u64(0), u64(entries.length), ...entries]);
}

test('GGUF inspect reads local Qwen architecture, tensor summary and tokenizer tags', async () => {
  const bytes = gguf('qwen3', [
    boolField('unimportant.flag', true),
    skipTokens(['hello', '世界', ''])
  ]);
  const m = parseGGUFMetadata(bytes);
  assert.equal(m.format, 'GGUF');
  assert.equal(m.architecture, 'qwen3');
  assert.equal(m.modelName, 'Qwen synthetic fixture');
  assert.equal(m.blockCount, 28);
  assert.equal(m.contextLength, 32768);
  assert.equal(m.tokenizer, 'gpt2');
  assert.equal(m.weightsVerified, false);
  assert.equal(m.metadataBytes, bytes.length);
  assert.equal(m.hasChatTemplate, false);
});

test('GGUF rejects wrong magic, unsupported version, oversize counts and truncation', () => {
  const valid = gguf();
  assert.throws(() => parseGGUFMetadata(Buffer.from('invalid')), /GGUF/);
  const version = Buffer.from(valid); version.writeUInt32LE(1, 4);
  assert.throws(() => parseGGUFMetadata(version), /version/);
  const count = Buffer.from(valid); count.writeBigUInt64LE(10001n, 16);
  assert.throws(() => parseGGUFMetadata(count), /counts/);
  assert.throws(() => parseGGUFMetadata(valid.subarray(0, valid.length - 1)), /truncated/);
  assert.throws(() => parseGGUFMetadata('GGUF'), /bytes/);
});

test('GGUF large and nested arrays are rejected before allocation', () => {
  const array = Buffer.concat([str('unimportant.flag'),u32(9),u32(8),u64(1000001)]);
  const header = Buffer.concat([Buffer.from('GGUF'),u32(3),u64(0),u64(2),
    textField('general.architecture','qwen3'),array]);
  assert.throws(() => parseGGUFMetadata(header), /array/);
});

test('Qwen model SHA256 is checked against real bytes, not metadata claims', async () => {
  const dir = await mkdtemp(join(tmpdir(),'sol0-qwen-test-'));
  try {
    const model = join(dir, 'fixture.gguf');
    const bytes = gguf();
    await writeFile(model, bytes);
    const m = await inspectGGUF(model);
    assert.equal(m.fileBytes, bytes.length);
    assert.equal(m.weightsVerified, false);
    assert.equal(await sha256File(model), createHash('sha256').update(bytes).digest('hex'));
    await assert.rejects(
      launchLocalQwen(parseArgs(['--model='+model,'--sha256='+'0'.repeat(64)]),
        {serveUI:()=>{throw new Error('UI should not start');}}),
      /SHA256 mismatch/
    );
  } finally { await rm(dir, {recursive:true,force:true}); }
});

test('CLI parser is opt-in, validates input and rejects port collisions', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs([]), /--model/);
  assert.throws(() => parseArgs(['--model=a.gguf','--model=b.gguf']), /Duplicate/);
  assert.throws(() => parseArgs(['--model=x.bin']), /gguf/);
  assert.throws(() => parseArgs(['--model=x.gguf','--port=8765','--ui-port=8765']), /differ/);
  assert.throws(() => parseArgs(['--model=x.gguf','--runner=--bad']), /runner/);
  assert.throws(() => parseArgs(['--model=x.gguf','--sha256=abc']), /sha256/);
  const options = parseArgs(['--model=./model.gguf']);
  assert.equal(options.port,9931);
  assert.equal(options.uiPort,8765);
  assert.equal(options.sha256,null);
  assert.equal(options.runner,'llama-server');
});

test('runner forces loopback, offline, safe CORS and disables runtime UI', () => {
  const options = parseArgs(['--model=./model.gguf','--port=9951','--ui-port=8851']);
  const args = buildRunnerArgs(options);
  assert.deepEqual(args.slice(0,2), ['--model',options.model]);
  assert.ok(args.includes('--offline'));
  assert.ok(args.includes('--no-webui'));
  assert.equal(args[args.indexOf('--host')+1],'127.0.0.1');
  assert.equal(args[args.indexOf('--cors-origins')+1],'http://127.0.0.1:8851');
  assert.equal(args[args.indexOf('--alias')+1], QWEN_ALIAS);
});

test('local UI serves only the bundled Sol0 HTML, not model bytes or repository files', async () => {
  const server = await startLocalUI({port:0});
  try {
    const port = server.address().port;
    const root = 'http://127.0.0.1:' + port;
    const html = await fetch(root + '/SolZero_Chat_Offline.html');
    assert.equal(html.status, 200);
    assert.match(await html.text(), /id="inferenceMode"/);
    assert.equal((await fetch(root + '/')).status, 200);
    assert.equal((await fetch(root + '/tools/gguf_inspect.mjs')).status, 404);
    assert.equal((await fetch(root + '/../../.git/config')).status, 404);
    const denied = await new Promise((resolve,reject)=>{
      const req=request({
        hostname:'127.0.0.1',port,path:'/SolZero_Chat_Offline.html',
        method:'GET',headers:{Host:'evil.example'}
      },res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      req.on('error',reject);
      req.end();
    });
    assert.equal(denied,403);
    assert.equal((await fetch(root, {method:'POST'})).status,405);
  } finally {
    await new Promise(resolve=>server.close(resolve));
  }
});

test('launch refuses non-Qwen model without invoking arbitrary subprocess', async () => {
  let spawned = false;
  const options = parseArgs(['--model=./model.gguf']);
  await assert.rejects(launchLocalQwen(options, {
    inspect:async()=>({architecture:'llama'}),
    spawnRunner:()=>{spawned=true;}
  }), /not Qwen-compatible/);
  assert.equal(spawned,false);
});

test('launch gives validated model path to a no-shell subprocess only', async () => {
  const dir = await mkdtemp(join(tmpdir(),'sol0-runner-test-'));
  const model = join(dir,'qwen.gguf');
  await writeFile(model,gguf('qwen2'));
  const options = parseArgs(['--model='+model]);
  let called;
  const fakeServer={close() {this.closed=true;}};
  const fakeChild=new EventEmitter();
  try {
    const launched = await launchLocalQwen(options,{
      serveUI:async()=>fakeServer,
      spawnRunner:(exe,args,params)=>{
        called={exe,args,params};
        return fakeChild;
      }
    });
    assert.equal(launched.metadata.architecture,'qwen2');
    assert.equal(launched.sha256Verified,false);
    assert.equal(called.exe,'llama-server');
    assert.equal(called.params.shell,false);
    assert.equal(called.args[called.args.indexOf('--model')+1],model);
    assert.equal(called.args[called.args.indexOf('--host')+1],'127.0.0.1');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('sliced loading: Qwen CLI bounds requested GPU and MoE CPU layers', () => {
  const opts=parseArgs(['--model=./qwen3.gguf','--gpu-layers=0','--cpu-moe-layers=8']);
  const args=buildRunnerArgs(opts);
  assert.equal(opts.gpuLayers,0);
  assert.equal(opts.cpuMoeLayers,8);
  assert.equal(args[args.indexOf('--n-gpu-layers')+1],'0');
  assert.equal(args[args.indexOf('--n-cpu-moe')+1],'8');
  for(const flag of ['--gpu-layers=-1','--gpu-layers=3.4','--gpu-layers=257',
      '--gpu-layers=Infinity','--cpu-moe-layers=-1','--cpu-moe-layers=999']) {
    assert.throws(()=>parseArgs(['--model=./qwen3.gguf',flag]),/(nonnegative|safe layer)/);
  }
  const defaults=buildRunnerArgs(parseArgs(['--model=./qwen3.gguf']));
  assert.ok(!defaults.includes('--n-gpu-layers'));
  assert.ok(!defaults.includes('--n-cpu-moe'));
});
