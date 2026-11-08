import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { splitModelBytes } from '../tools/model_chunks.mjs';
import {
  openChunkModel, indexChunkedGGUF, dotQ8ChunkBlock, decodeF16
} from '../tools/lazy_gguf.mjs';

const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const str=s=>{const b=Buffer.from(s);return Buffer.concat([u64(b.length),b]);};
const kvString=(k,v)=>Buffer.concat([str(k),u32(8),str(v)]);
const kvNum=(k,v)=>Buffer.concat([str(k),u32(4),u32(v)]);
const kvTokens=(k,tokens)=>Buffer.concat([
  str(k),u32(9),u32(8),u64(tokens.length),...tokens.map(str)
]);

function makeQwenGGUF({crossBoundary=false,architecture='qwen3'}={}){
  const metadata=[
    kvString('general.architecture',architecture),
    kvNum('general.alignment',32),
    kvTokens('tokenizer.ggml.tokens',['<|endoftext|>','hello','世界','']),
  ];
  const directoryName='blk.0.attn_q.weight';
  const infoPrefix=Buffer.concat([str(directoryName),u32(2),u64(32),u64(1),u32(8)]);
  const provisional=Buffer.concat([
    Buffer.from('GGUF'),u32(3),u64(1),u64(metadata.length),
    ...metadata,infoPrefix,u64(0)
  ]);
  const dataStart=Math.ceil(provisional.length/32)*32;
  const tensorOffset=crossBoundary?(992-dataStart):0;
  if(tensorOffset<0||tensorOffset%32!==0)throw Error('bad test padding');
  const directory=Buffer.concat([
    Buffer.from('GGUF'),u32(3),u64(1),u64(metadata.length),
    ...metadata,infoPrefix,u64(tensorOffset)
  ]);
  const prefix=Buffer.alloc(dataStart);directory.copy(prefix);
  const weights=Buffer.alloc(tensorOffset+34);
  // One Q8_0 block: F16 scale=0.5 (0x3800); 32 signed int8 weights.
  weights.writeUInt16LE(0x3800,tensorOffset);
  for(let i=0;i<32;i++)weights.writeInt8(i-8,tensorOffset+2+i);
  return {bytes:Buffer.concat([prefix,weights]),dataStart,tensorOffset,tensorName:directoryName};
}

async function withModel(fn,fixture=makeQwenGGUF()){
  const dir=await mkdtemp(join(tmpdir(),'sol0-lazy-model-'));
  const file=join(dir,'qwen.gguf'),parts=join(dir,'parts');
  try {
    await writeFile(file,fixture.bytes);
    await splitModelBytes(file,parts,{chunkBytes:1024});
    await fn({dir,file,parts,fixture});
  }finally{await rm(dir,{recursive:true,force:true});}
}

test('lossless verified range across chunk boundary without reconstructed GGUF file',async()=>{
  await withModel(async({dir,parts,fixture})=>{
    const manifest=join(parts,'manifest.json');
    const s=await openChunkModel(manifest);
    const a=await s.readRange(980,64);
    assert.deepEqual(a,fixture.bytes.subarray(980,1044));
    assert.equal(s.totalBytes,fixture.bytes.length);
    assert.equal(s.statistics.diskReassembly,false);
    assert.equal(s.statistics.uniqueChunksRead,2);
    assert.equal(s.statistics.partCount,2);
    await assert.rejects(access(join(dir,'restored.gguf')));
  },makeQwenGGUF({crossBoundary:true}));
});

test('Q8_0 tensor index and 32-value dot product read directly from chunked Qwen weights',async()=>{
  await withModel(async({parts,fixture})=>{
    const store=await openChunkModel(join(parts,'manifest.json'));
    const index=await indexChunkedGGUF(store);
    assert.equal(index.architecture,'qwen3');
    assert.equal(index.version,3);
    assert.equal(index.tensorCount,1);
    assert.equal(index.metadataCount,3);
    assert.equal(index.dataStart,fixture.dataStart);
    const sample=await dotQ8ChunkBlock(store,index,{tensorName:fixture.tensorName,
      vector:Array(32).fill(1)});
    assert.equal(sample.dot,120);
    assert.equal(sample.scale,0.5);
    assert.deepEqual(sample.firstFourWeights,[-4,-3.5,-3,-2.5]);
    assert.equal(sample.sourceOffset,fixture.dataStart+fixture.tensorOffset);
    assert.equal(sample.modelBytesRebuilt,0);
    assert.ok(store.statistics.uniqueChunksRead <= store.partCount);
  },makeQwenGGUF({crossBoundary:true}));
});

test('lazy tensor reader rejects tampered bytes before any Q8 kernel executes',async()=>{
  await withModel(async({parts})=>{
    const path=join(parts,'part-000001.bin');
    const data=await readFile(path);data[0]^=0xff;
    await writeFile(path,data);
    const store=await openChunkModel(join(parts,'manifest.json'));
    const index=await indexChunkedGGUF(store);
    await assert.rejects(dotQ8ChunkBlock(store,index,{}),/SHA256 mismatch/);
  },makeQwenGGUF({crossBoundary:true}));
});

test('lazy reader rejects invalid manifest, range errors and invalid Q8 vector',async()=>{
  await withModel(async({parts,fixture})=>{
    const mp=join(parts,'manifest.json'),m=JSON.parse(await readFile(mp,'utf8'));
    const store=await openChunkModel(mp);
    await assert.rejects(store.readRange(-1,1),/range/);
    await assert.rejects(store.readRange(0,1024*1024+1),/range/);
    await assert.rejects(store.readRange(store.totalBytes,1),/range/);
    const index=await indexChunkedGGUF(store);
    await assert.rejects(dotQ8ChunkBlock(store,index,{tensorName:fixture.tensorName,
      vector:[1,2]}),/32 finite/);
    await assert.rejects(dotQ8ChunkBlock(store,index,{tensorName:fixture.tensorName,
      blockIndex:1}),/index out of range/);
    m.parts[0].name='../secret.bin';
    await writeFile(mp,JSON.stringify(m));
    await assert.rejects(openChunkModel(mp),/Unsafe/);
  });
});

test('full GGUF header missing, wrong architecture or quantization type is rejected',async()=>{
  await withModel(async({parts})=>{
    const store=await openChunkModel(join(parts,'manifest.json'));
    const index=await indexChunkedGGUF(store);
    await assert.rejects(dotQ8ChunkBlock(store,index,{tensorName:'missing'}),
      /not GGML Q8_0/);
  });
  await withModel(async({parts})=>{
    const store=await openChunkModel(join(parts,'manifest.json'));
    await assert.rejects(indexChunkedGGUF(store),/only Qwen/);
  },makeQwenGGUF({architecture:'llama'}));
});

test('actual unmodified GGUF bytes have the same quantized dot product as chunked input',async()=>{
  await withModel(async({file,parts,fixture})=>{
    const source=await readFile(file);
    const orig=source.subarray(fixture.dataStart+fixture.tensorOffset,
      fixture.dataStart+fixture.tensorOffset+34);
    const scale=decodeF16(orig.readUInt16LE(0));
    let reference=0;
    for(let i=0;i<32;i++)reference+=orig.readInt8(i+2)*scale;
    const store=await openChunkModel(join(parts,'manifest.json'));
    const index=await indexChunkedGGUF(store);
    const result=await dotQ8ChunkBlock(store,index,{});
    assert.equal(result.dot,reference);
    assert.equal(result.dot,120);
  });
});
