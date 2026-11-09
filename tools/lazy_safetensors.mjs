/**
 * A bounded selective matvec primitive over Kimi-style sharded safetensors.
 * It reads one named tensor range without loading or joining the other shards.
 * This is not Kimi Transformer execution or a replacement for vLLM.
 */
import { lstat, open, readdir, readFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { decodeF16 } from './lazy_gguf.mjs';

const MAX_HEADER=32*1024*1024;
const MAX_INDEX=16*1024*1024;
const MAX_ELEMENTS=8192;
const NAME=/^[A-Za-z0-9_.-]+\.safetensors$/;

function safeObject(data,label){
  let obj;
  try{obj=JSON.parse(data.toString('utf8'));}catch{throw new Error('Invalid '+label+' JSON');}
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('Invalid '+label+' object');
  return obj;
}
async function readExact(handle,len,start){
  const out=Buffer.alloc(len);
  let got=0;
  while(got<len){
    const r=await handle.read(out,got,len-got,start+got);
    if(r.bytesRead===0)throw new Error('Truncated safetensors bytes');
    got+=r.bytesRead;
  }
  return out;
}
function bytesPerValue(dtype){
  if(dtype==='F32')return 4;
  if(dtype==='F16'||dtype==='BF16')return 2;
  throw new Error('Selective Kimi kernel supports F32/F16/BF16 only');
}
function toNumber(raw,offset,dtype){
  if(dtype==='F32')return raw.readFloatLE(offset);
  if(dtype==='F16')return decodeF16(raw.readUInt16LE(offset));
  const temp=Buffer.alloc(4);
  temp.writeUInt16LE(raw.readUInt16LE(offset),2);
  return temp.readFloatLE();
}
function validShardName(value){
  if(typeof value!=='string'||basename(value)!==value||!NAME.test(value)){
    throw new Error('Invalid or traversal safetensors shard path');
  }
  return value;
}

export async function dotShardedSafetensors(sourceDir,{
  tensorName,elementOffset=0,count=32,vector=null
}={}){
  if(typeof sourceDir!=='string'||!sourceDir.trim()||
    typeof tensorName!=='string'||!tensorName||tensorName.length>512){
    throw new Error('Explicit local shard directory and tensor name required');
  }
  if(!Number.isSafeInteger(elementOffset)||elementOffset<0||
    !Number.isSafeInteger(count)||count<1||count>MAX_ELEMENTS){
    throw new Error('Selective safetensors range exceeds safe bounds');
  }
  const dir=resolve(sourceDir);
  const modelDir=await lstat(dir);
  if(!modelDir.isDirectory())throw new Error('Safetensors model path is not directory');
  const indexPath=join(dir,'model.safetensors.index.json');
  let shardName;
  const entries=await readdir(dir,{withFileTypes:true});
  const indexEntry=entries.find(e=>e.name==='model.safetensors.index.json');
  if(indexEntry){
    const stat=await lstat(indexPath);
    if(!stat.isFile()||stat.size>MAX_INDEX)throw new Error('Safetensors shard index outside bounds');
    const index=safeObject(await readFile(indexPath),'safetensors index');
    shardName=validShardName(index.weight_map?.[tensorName]);
  } else {
    const shards=entries.filter(e=>e.isFile()&&e.name.endsWith('.safetensors'));
    if(shards.length!==1)throw new Error('Unindexed safetensors requires exactly one local shard');
    shardName=validShardName(shards[0].name);
  }
  const path=join(dir,shardName);
  const info=await lstat(path);
  if(!info.isFile()||info.size<10)throw new Error('Missing safetensors shard');
  const file=await open(path,'r');
  try{
    const size=Number((await readExact(file,8,0)).readBigUInt64LE());
    if(!Number.isSafeInteger(size)||size<2||size>MAX_HEADER||size+8>info.size){
      throw new Error('Safetensors header outside safe bounds');
    }
    const header=safeObject(await readExact(file,size,8),'safetensors header');
    const descriptor=header[tensorName];
    if(!descriptor||!Array.isArray(descriptor.shape)||!Array.isArray(descriptor.data_offsets)
      ||descriptor.data_offsets.length!==2||!descriptor.shape.length||
      !descriptor.shape.every(n=>Number.isSafeInteger(n)&&n>=1)){
      throw new Error('Missing or invalid named tensor descriptor');
    }
    const elemBytes=bytesPerValue(descriptor.dtype);
    let total=1;
    for(const d of descriptor.shape){
      total*=d;
      if(!Number.isSafeInteger(total))throw new Error('Tensor dimensions exceed safe bounds');
    }
    const [start,end]=descriptor.data_offsets;
    const dataBytes=info.size-size-8;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
      start<0||end>dataBytes||end-start!==total*elemBytes||
      elementOffset>total-count){
      throw new Error('Tensor data offsets or requested range exceed bounds');
    }
    const v=vector??Array(count).fill(1);
    if(!Array.isArray(v)||v.length!==count||
      !v.every(n=>typeof n==='number'&&Number.isFinite(n))){
      throw new Error('Selective tensor dot requires finite input vector');
    }
    const absolute=8+size+start+elementOffset*elemBytes;
    const raw=await readExact(file,count*elemBytes,absolute);
    let dot=0;
    for(let i=0;i<count;i++)dot+=toNumber(raw,i*elemBytes,descriptor.dtype)*v[i];
    if(!Number.isFinite(dot))throw new Error('Nonfinite selective tensor dot');
    return Object.freeze({
      tensorName,shardName,dtype:descriptor.dtype,
      tensorElements:total,elementOffset,elementsRead:count,
      tensorBytesRead:raw.length,shardTotalBytes:info.size,
      dot,modelFilesJoined:0,
      note:'Selective numeric tensor operation, not Kimi text generation'
    });
  }finally{await file.close();}
}
