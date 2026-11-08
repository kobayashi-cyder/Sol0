import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dotShardedSafetensors } from '../tools/lazy_safetensors.mjs';

const VALUES=[1,2,-1,0.5];
function fixture(dtype='BF16'){
  const raw=Buffer.alloc(VALUES.length*(dtype==='F32'?4:2));
  const halves={F16:[0x3c00,0x4000,0xbc00,0x3800],
    BF16:[0x3f80,0x4000,0xbf80,0x3f00]};
  VALUES.forEach((n,i)=>{
    if(dtype==='F32')raw.writeFloatLE(n,i*4);
    else raw.writeUInt16LE(halves[dtype][i],i*2);
  });
  const name='model.layers.0.mlp.gate_proj.weight';
  const metadata={[name]:{dtype,shape:[VALUES.length],data_offsets:[0,raw.length]}};
  const header=Buffer.from(JSON.stringify(metadata));
  const length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));
  return {name,bytes:Buffer.concat([length,header,raw])};
}

async function workspace(fn){
  const dir=await mkdtemp(join(tmpdir(),'sol0-kimi-lazy-'));
  try {await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}
}

test('Kimi-style BF16 tensors can be selected from one shard and dotted without joining shards',async()=>{
  await workspace(async dir=>{
    const {name,bytes}=fixture('BF16');
    await writeFile(join(dir,'model-00001.safetensors'),bytes);
    await writeFile(join(dir,'unrelated.safetensors'),Buffer.from('not a safetensors model'));
    await writeFile(join(dir,'model.safetensors.index.json'),
      JSON.stringify({weight_map:{[name]:'model-00001.safetensors'}}));
    const result=await dotShardedSafetensors(dir,{tensorName:name,count:4});
    assert.equal(result.dot,2.5);
    assert.equal(result.dtype,'BF16');
    assert.equal(result.elementsRead,4);
    assert.equal(result.tensorBytesRead,8);
    assert.equal(result.modelFilesJoined,0);
    assert.ok(result.shardTotalBytes>result.tensorBytesRead);
    assert.equal(result.shardName,'model-00001.safetensors');
  });
});

test('Kimi F16 and F32 shards use correct numeric conversion and vector multiplication',async()=>{
  for(const dtype of ['F16','F32']){
    await workspace(async dir=>{
      const {name,bytes}=fixture(dtype);
      await writeFile(join(dir,'model.safetensors'),bytes);
      const result=await dotShardedSafetensors(dir,{
        tensorName:name,count:4,vector:[2,3,4,5]
      });
      assert.equal(result.dot,1*2+2*3-1*4+0.5*5);
      assert.equal(result.modelFilesJoined,0);
      const partial=await dotShardedSafetensors(dir,{
        tensorName:name,elementOffset:2,count:2
      });
      assert.equal(partial.dot,-0.5);
    });
  }
});

test('Safetensors selective load refuses missing, out-of-bounds, NaN and malformed tensors',async()=>{
  await workspace(async dir=>{
    const {name,bytes}=fixture();
    await writeFile(join(dir,'model.safetensors'),bytes);
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:name,elementOffset:3,count:2}),/range exceed bounds/);
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:name,count:4,vector:[1,1,NaN,1]}),/finite/);
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:name,count:9000}),/safe bounds/);
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:'no.such.tensor',count:1}),/descriptor/);
    await writeFile(join(dir,'model.safetensors'),Buffer.from('corrupt'));
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:name,count:1}),/Missing safetensors shard/);
  });
});

test('Safetensors index never accepts path traversal or absent shards',async()=>{
  await workspace(async dir=>{
    const {name,bytes}=fixture();
    await writeFile(join(dir,'model.safetensors'),bytes);
    const index=join(dir,'model.safetensors.index.json');
    await writeFile(index,JSON.stringify({weight_map:{[name]:'../secret.safetensors'}}));
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:name,count:1}),/traversal/);
    await writeFile(index,JSON.stringify({weight_map:{[name]:'missing.safetensors'}}));
    await assert.rejects(dotShardedSafetensors(dir,{tensorName:name,count:1}),/ENOENT/);
  });
});
