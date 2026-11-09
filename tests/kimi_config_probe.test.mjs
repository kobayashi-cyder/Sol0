import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseConfigArgs, inspectKimiConfigFile} from '../tools/kimi_config_probe.mjs';

test('Kimi config probe does not need any model tensor or executable Python',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sol0-kimi-config-'));
  const file=join(dir,'config.json');
  try {
    await writeFile(file,JSON.stringify({
      model_type:'kimi_k2',architectures:['DeepseekV3ForCausalLM'],
      auto_map:{AutoModel:'modeling_deepseek.DeepseekV3ForCausalLM'},
      num_hidden_layers:61,n_routed_experts:384,num_experts_per_tok:8
    }));
    const args=parseConfigArgs(['--config='+file,'--expect=kimi_k2']);
    const result=await inspectKimiConfigFile(args);
    assert.equal(result.modelType,'kimi_k2');
    assert.equal(result.routedExperts,384);
    assert.equal(result.activeExpertsPerToken,8);
    assert.equal(result.layers,61);
    assert.equal(result.weightsLoaded,false);
    await assert.rejects(inspectKimiConfigFile({...args,expectedType:'kimi_linear'}),/Unexpected/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Kimi config probe refuses invalid names, unsafe paths and invalid JSON',async()=>{
  assert.throws(()=>parseConfigArgs([]),/Explicit/);
  assert.throws(()=>parseConfigArgs(['--config=/tmp/a','--expect=llama']),/Unexpected/);
  assert.throws(()=>parseConfigArgs(['--config=/tmp/a','--expect=kimi_k2','--config=/tmp/b']),/duplicate/);
  const dir=await mkdtemp(join(tmpdir(),'sol0-kimi-config-'));
  try{
    const file=join(dir,'config.json');
    await writeFile(file,Buffer.from('not json'));
    await assert.rejects(inspectKimiConfigFile(parseConfigArgs(['--config='+file,'--expect=kimi_k2'])),/JSON/);
    await writeFile(file,Buffer.alloc(256*1024+1));
    await assert.rejects(inspectKimiConfigFile(parseConfigArgs(['--config='+file,'--expect=kimi_k2'])),/bounded/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
