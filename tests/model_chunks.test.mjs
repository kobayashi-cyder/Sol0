import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  splitModelBytes, reassembleModelBytes, parseChunkArgs, CHUNK_LIMITS
} from '../tools/model_chunks.mjs';

async function workspace(fn) {
  const dir=await mkdtemp(join(tmpdir(),'sol0-model-bytes-'));
  try { await fn(dir); } finally { await rm(dir,{recursive:true,force:true}); }
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('HEX-equivalent bytes are split, ordered and reassembled exactly (including 00 and ff)', async () => {
  await workspace(async dir=>{
    const data=randomBytes(1024*11+123);
    data[0]=0;data[1]=255;data[data.length-1]=0;
    const source=join(dir,'synthetic-model.gguf'),parts=join(dir,'parts'),restored=join(dir,'restored.gguf');
    await writeFile(source,data);
    const manifest=await splitModelBytes(source,parts,{chunkBytes:1024});
    assert.equal(manifest.parts.length,12);
    assert.equal(manifest.totalBytes,data.length);
    assert.equal(manifest.sha256,sha256(data));
    assert.equal(manifest.parts[0].name,'part-000000.bin');
    assert.equal(manifest.parts.at(-1).bytes,123);
    assert.equal(manifest.parts[0].sha256,sha256(data.subarray(0,1024)));
    const result=await reassembleModelBytes(join(parts,'manifest.json'),restored);
    assert.equal(result.verified,true);
    assert.equal(result.sha256,sha256(data));
    assert.deepEqual(await readFile(restored),data);
    assert.deepEqual(await readFile(source),data);
  });
});

test('multi-megabyte synthetic Kimi safetensors bytes round-trip without a text/HEX transformation',async()=>{
  await workspace(async dir=>{
    const data=randomBytes(3*1024*1024+7);
    const source=join(dir,'model-00001.safetensors');
    await writeFile(source,data);
    await splitModelBytes(source,join(dir,'slices'),{chunkBytes:64*1024});
    await reassembleModelBytes(join(dir,'slices','manifest.json'),join(dir,'joined.safetensors'));
    assert.deepEqual(await readFile(join(dir,'joined.safetensors')),data);
  });
});

test('chunk integrity failure refuses restoration and removes only a newly created partial output',async()=>{
  await workspace(async dir=>{
    const source=join(dir,'model.gguf'),parts=join(dir,'parts'),restored=join(dir,'restored.gguf');
    await writeFile(source,randomBytes(2049));
    await splitModelBytes(source,parts,{chunkBytes:1024});
    await writeFile(join(parts,'part-000001.bin'),Buffer.alloc(1024,42));
    await assert.rejects(reassembleModelBytes(join(parts,'manifest.json'),restored),/checksum mismatch/);
    await assert.rejects(access(restored));
    assert.ok((await stat(source)).size===2049);
  });
});

test('missing chunk, fake size, reordered names and traversal fail closed',async()=>{
  await workspace(async dir=>{
    const source=join(dir,'model.bin'),parts=join(dir,'parts'),out=join(dir,'restored.bin');
    await writeFile(source,randomBytes(2049));
    await splitModelBytes(source,parts,{chunkBytes:1024});
    const manifestPath=join(parts,'manifest.json');
    const original=JSON.parse(await readFile(manifestPath,'utf8'));
    for(const mutate of [
      m=>{m.parts[0].name='../secret.bin';},
      m=>{m.parts.reverse();},
      m=>{m.parts[0].bytes++;},
      m=>{m.sha256='bad';},
      m=>{m.totalBytes=3;}
    ]) {
      const m=structuredClone(original);
      mutate(m);
      await writeFile(manifestPath,JSON.stringify(m));
      await assert.rejects(reassembleModelBytes(manifestPath,out));
      await assert.rejects(access(out));
    }
    await writeFile(manifestPath,JSON.stringify(original));
    await rm(join(parts,'part-000001.bin'));
    await assert.rejects(reassembleModelBytes(manifestPath,out),/missing or wrong length/);
    await assert.rejects(access(out));
  });
});

test('never overwrite user-created model, existing output or existing chunk directory',async()=>{
  await workspace(async dir=>{
    const source=join(dir,'model.gguf'),parts=join(dir,'parts'),out=join(dir,'restored.gguf');
    await writeFile(source,Buffer.alloc(3073,123));
    await splitModelBytes(source,parts,{chunkBytes:1024});
    await assert.rejects(splitModelBytes(source,parts,{chunkBytes:1024}),/EEXIST/);
    await writeFile(out,'retain-this-file');
    await assert.rejects(reassembleModelBytes(join(parts,'manifest.json'),out),/EEXIST/);
    assert.equal(await readFile(out,'utf8'),'retain-this-file');
    assert.deepEqual((await readdir(parts)).sort(),[
      'manifest.json','part-000000.bin','part-000001.bin','part-000002.bin','part-000003.bin'
    ]);
  });
});

test('limits and CLI input reject oversized chunks, unsafe flags and empty source',async()=>{
  for(const n of [0,NaN,Infinity,-1,CHUNK_LIMITS.maxBytes+1,1.2]) {
    assert.throws(()=>parseChunkArgs(['split','--input=model.gguf','--out=parts','--chunk-bytes='+n]),/chunkBytes/);
  }
  assert.equal(parseChunkArgs(['split','--input=a','--out=b']).chunkBytes,CHUNK_LIMITS.defaultBytes);
  assert.equal(parseChunkArgs(['join','--manifest=a','--out=b']).command,'join');
  assert.throws(()=>parseChunkArgs(['join','--input=a','--out=b']),/manifest/);
  assert.throws(()=>parseChunkArgs(['split','--input=a','--out=b','--out=c']),/duplicate/);
  await workspace(async dir=>{
    const empty=join(dir,'empty.gguf');
    await writeFile(empty,Buffer.alloc(0));
    await assert.rejects(splitModelBytes(empty,join(dir,'parts')),/nonempty/);
  });
});
