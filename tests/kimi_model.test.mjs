import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { inspectSafetensorsFile, inspectLocalKimiModel, verifyKimiShardHashes, inspectKimiConfiguration } from '../tools/kimi_model.mjs';
import {
  parseKimiArgs, buildVllmArgs, offlineVllmEnv, launchLocalKimi, KIMI_ALIAS
} from '../tools/kimi_local.mjs';

function safetensors(tensors = {linear:{dtype:'F32',shape:[1],data_offsets:[0,4]}}, payload = Buffer.alloc(4)) {
  const header = Buffer.from(JSON.stringify(tensors));
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length,header,payload]);
}

async function fixture(type='kimi_vl', configPatch={}) {
  const dir = await mkdtemp(join(tmpdir(),'sol0-kimi-test-'));
  await writeFile(join(dir,'config.json'), JSON.stringify({
    model_type:type,
    architectures:[({
      qwen2:'Qwen2ForCausalLM',
      kimi_vl:'KimiVLForConditionalGeneration',
      kimi_k2:'DeepseekV3ForCausalLM',
      kimi_k25:'KimiK25ForConditionalGeneration',
      kimi_linear:'KimiLinearForCausalLM'
    })[type] ?? 'UnknownForCausalLM'],
    ...configPatch
  }));
  await writeFile(join(dir,'model-00001.safetensors'),safetensors());
  return dir;
}

test('Kimi safetensors decoder checks on-disk tensor offsets without reading weights', async () => {
  const dir = await fixture();
  try {
    const r = await inspectSafetensorsFile(join(dir,'model-00001.safetensors'));
    assert.equal(r.tensorCount,1);
    assert.ok(r.headerBytes > 0);
    assert.ok(r.fileBytes > r.headerBytes);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('Kimi safetensors decoder rejects truncated, invalid and overlapping descriptors', async () => {
  const dir = await fixture();
  const path = join(dir,'model-00001.safetensors');
  try {
    await writeFile(path,Buffer.alloc(3));
    await assert.rejects(inspectSafetensorsFile(path),/invalid/);
    const oversized = Buffer.alloc(12);
    oversized.writeBigUInt64LE(1000000000n);
    await writeFile(path,oversized);
    await assert.rejects(inspectSafetensorsFile(path),/safe bounds/);
    await writeFile(path,safetensors({
      a:{dtype:'F32',shape:[1],data_offsets:[0,4]},
      b:{dtype:'F32',shape:[1],data_offsets:[2,4]}
    }));
    await assert.rejects(inspectSafetensorsFile(path),/Overlapping/);
    await writeFile(path,safetensors({
      a:{dtype:'F32',shape:[1],data_offsets:[0,5]}
    }));
    await assert.rejects(inspectSafetensorsFile(path),/offset/);
    await writeFile(path,safetensors({
      a:{dtype:'F32',shape:[-1],data_offsets:[0,4]}
    }));
    await assert.rejects(inspectSafetensorsFile(path),/descriptor/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('Kimi checkpoint inspection validates supported architectures and shard presence', async () => {
  for(const type of ['kimi_vl','kimi_k2','kimi_k25','kimi_linear']) {
    const dir = await fixture(type);
    try {
      const r = await inspectLocalKimiModel(dir);
      assert.equal(r.modelType,type);
      assert.equal(r.shards,1);
      assert.equal(r.headersChecked,1);
      assert.equal(r.weightsAuthenticated,false);
    } finally { await rm(dir,{recursive:true,force:true}); }
  }
});

test('Kimi-Dev qwen2 needs an explicit family declaration', async () => {
  const dir = await fixture('qwen2');
  try {
    await assert.rejects(inspectLocalKimiModel(dir),/Kimi-Dev/);
    const r = await inspectLocalKimiModel(dir,{family:'kimi-dev'});
    assert.equal(r.family,'kimi-dev');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('Kimi inspection rejects unrelated architecture, invalid config and missing weight shards', async () => {
  const dir = await fixture('llama');
  try {
    await assert.rejects(inspectLocalKimiModel(dir),/not recognized/);
    await writeFile(join(dir,'config.json'), '{not json');
    await assert.rejects(inspectLocalKimiModel(dir),/JSON/);
    await writeFile(join(dir,'config.json'),JSON.stringify({model_type:'kimi_vl',architectures:['KimiVLForConditionalGeneration']}));
    await rm(join(dir,'model-00001.safetensors'));
    await assert.rejects(inspectLocalKimiModel(dir),/safetensors shards/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('Kimi manifest requires every filename and prohibits path traversal', async () => {
  const dir = await fixture();
  try {
    const path = join(dir,'model.safetensors.index.json');
    await writeFile(path, JSON.stringify({weight_map:{foo:'missing.safetensors'}}));
    await assert.rejects(inspectLocalKimiModel(dir),/missing or unsafe/);
    await writeFile(path, JSON.stringify({weight_map:{foo:'../model-00001.safetensors'}}));
    await assert.rejects(inspectLocalKimiModel(dir),/missing or unsafe/);
    await writeFile(path, JSON.stringify({weight_map:{foo:'model-00001.safetensors'}}));
    const r = await inspectLocalKimiModel(dir);
    assert.equal(r.shards,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('Kimi runner rejects nonlocal model arguments, port collisions and unexpected args', () => {
  assert.equal(parseKimiArgs(['--help']).help,true);
  assert.throws(()=>parseKimiArgs([]),/model-dir/);
  assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/a','--model-dir=/tmp/b']),/Duplicate/);
  assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/a','--port=8766','--ui-port=8766']),/differ/);
  assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/a','--runner=--nope']),/runner/);
  assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/a','--family=kimi_vl']),/family/);
  assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/a','--max-model-len=0']),/range/);
  assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/a','--unknown=x']),/Unknown/);
  assert.equal(parseKimiArgs(['--model-dir=/tmp/a']).allowModelCode,false);
});

test('Kimi vLLM args are loopback only, CORS scoped and not trusted by default', () => {
  const options = parseKimiArgs(['--model-dir=/tmp/a']);
  const args = buildVllmArgs(options);
  assert.deepEqual(args.slice(0,2),['serve',options.modelDir]);
  assert.equal(args[args.indexOf('--host')+1],'127.0.0.1');
  assert.equal(args[args.indexOf('--allowed-origins')+1],'http://127.0.0.1:8766');
  assert.equal(args[args.indexOf('--served-model-name')+1],KIMI_ALIAS);
  assert.ok(args.includes('--no-allow-credentials'));
  assert.ok(!args.includes('--trust-remote-code'));
  assert.ok(buildVllmArgs(parseKimiArgs(['--model-dir=/tmp/a','--allow-model-code']))
    .includes('--trust-remote-code'));
  const env = offlineVllmEnv({MY_PRIVATE_TEST:'not-logged'});
  assert.equal(env.HF_HUB_OFFLINE,'1');
  assert.equal(env.TRANSFORMERS_OFFLINE,'1');
  assert.equal(env.VLLM_NO_USAGE_STATS,'1');
});

test('Kimi refuses model-supplied Python without explicit approval', async () => {
  const dir = await fixture('kimi_vl',{auto_map:{AutoModel:'modeling_kimi_vl.KimiVL'}});
  let spawned=false;
  try {
    await assert.rejects(launchLocalKimi(parseKimiArgs(['--model-dir='+dir]),{
      spawnRunner:()=>{spawned=true;}
    }),/allow-model-code/);
    assert.equal(spawned,false);
  } finally { await rm(dir,{recursive:true,force:true});}
});

test('Kimi subprocess is launched without shell, with offline env and explicit model code approval', async () => {
  const dir = await fixture('kimi_vl',{auto_map:{AutoModel:'modeling_kimi_vl.KimiVL'}});
  const options = parseKimiArgs(['--model-dir='+dir,'--allow-model-code']);
  let called;
  const fakeServer={close() {this.closed=true;}};
  const child = new EventEmitter();
  try {
    const r = await launchLocalKimi(options,{
      serveUI:async()=>fakeServer,
      spawnRunner:(file,args,config)=>{
        called={file,args,config};
        return child;
      }
    });
    assert.equal(r.summary.modelType,'kimi_vl');
    assert.equal(called.file,'vllm');
    assert.equal(called.config.shell,false);
    assert.equal(called.config.env.HF_HUB_OFFLINE,'1');
    assert.equal(called.config.env.VLLM_NO_USAGE_STATS,'1');
    assert.ok(called.args.includes('--trust-remote-code'));
    assert.equal(called.args[1],dir);
    assert.equal(called.args[called.args.indexOf('--host')+1],'127.0.0.1');
    fakeServer.close();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('complete Kimi SHA256 manifest is verified byte-for-byte before subprocess startup', async () => {
  const dir=await fixture('kimi_vl');
  const name='model-00001.safetensors';
  const bytes=await readFile(join(dir,name));
  const digest=createHash('sha256').update(bytes).digest('hex');
  const manifest=join(dir,'verified-sha256.json');
  try {
    const summary=await inspectLocalKimiModel(dir);
    await writeFile(manifest,JSON.stringify({version:1,files:{[name]:digest}}));
    assert.equal(await verifyKimiShardHashes(summary,manifest),true);
    const opts=parseKimiArgs(['--model-dir='+dir,'--sha256-manifest='+manifest]);
    let spawned=false,served=false;
    const r=await launchLocalKimi(opts,{
      serveUI:async()=>{served=true;return {close(){}};},
      spawnRunner:()=>{spawned=true;return new EventEmitter();}
    });
    assert.equal(r.hashesVerified,true);
    assert.equal(spawned,true);
    assert.equal(served,true);
    await writeFile(manifest,JSON.stringify({version:1,files:{[name]:'0'.repeat(64)}}));
    spawned=false;served=false;
    await assert.rejects(launchLocalKimi(opts,{
      serveUI:async()=>{served=true;return {close(){}};},
      spawnRunner:()=>{spawned=true;return new EventEmitter();}
    }),/SHA256 mismatch/);
    assert.equal(spawned,false);
    assert.equal(served,false);
    await writeFile(manifest,JSON.stringify({version:1,files:{wrong:'0'.repeat(64)}}));
    await assert.rejects(verifyKimiShardHashes(summary,manifest),/every shard/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('sliced loading: Kimi CPU offload is bounded, explicit and disabled by default', () => {
  const base=parseKimiArgs(['--model-dir=/tmp/Kimi']);
  assert.equal(base.cpuOffloadGb,null);
  assert.ok(!buildVllmArgs(base).includes('--cpu-offload-gb'));
  const requested=parseKimiArgs(['--model-dir=/tmp/Kimi','--cpu-offload-gb=8.5']);
  const args=buildVllmArgs(requested);
  assert.equal(requested.cpuOffloadGb,8.5);
  assert.equal(args[args.indexOf('--cpu-offload-gb')+1],'8.5');
  for(const value of ['-1','NaN','Infinity','1025','4.123','abc']) {
    assert.throws(()=>parseKimiArgs(['--model-dir=/tmp/Kimi','--cpu-offload-gb='+value]),/(nonnegative|safe range)/);
  }
});


test('publisher Kimi configurations can be assessed without weight downloads', () => {
  const models=[
    ['kimi_vl','KimiVLForConditionalGeneration'],
    ['kimi_k2','DeepseekV3ForCausalLM'],
    ['kimi_k25','KimiK25ForConditionalGeneration'],
    ['kimi_linear','KimiLinearForCausalLM']
  ];
  for (const [model_type,architecture] of models){
    const meta=inspectKimiConfiguration({
      model_type,architectures:[architecture],
      auto_map:{AutoConfig:'trusted.publisher.Module'},
      num_hidden_layers:27,n_routed_experts:64,num_experts_per_tok:6
    });
    assert.equal(meta.modelType,model_type);
    assert.equal(meta.architecture,architecture);
    assert.equal(meta.weightsLoaded,false);
    assert.equal(meta.textInferenceVerified,false);
    assert.equal(meta.routedExperts,64);
    assert.equal(meta.activeExpertsPerToken,6);
    assert.equal(meta.requiresCustomCode,true);
  }
  assert.throws(()=>inspectKimiConfiguration({model_type:'qwen2',architectures:['Qwen2ForCausalLM']}),/Kimi-Dev/);
  assert.equal(inspectKimiConfiguration({model_type:'qwen2',architectures:['Qwen2ForCausalLM']},
    {family:'kimi-dev'}).family,'kimi-dev');
  assert.throws(()=>inspectKimiConfiguration({model_type:'kimi_vl',architectures:[]}),/architecture/);
  assert.throws(()=>inspectKimiConfiguration({model_type:'kimi_k2',architectures:['DeepseekV3ForCausalLM'],
    n_routed_experts:8,num_experts_per_tok:9}),/expert count/);
});
