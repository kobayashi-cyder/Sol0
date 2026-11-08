/**
 * Lazy tensor reader for chunked GGUF v2/v3. This is intentionally a narrow
 * proof of out-of-core WEIGHT OPERATIONS, not complete Qwen text inference.
 * Nothing writes a reconstructed GGUF file.
 */
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';

const PART_PATTERN=/^part-(\d{6})\.bin$/;
const SHA=/^[0-9a-f]{64}$/;
const CHUNK_MAX=128*1024*1024;
const HEADER_MAX=48*1024*1024;
const WINDOW_BYTES=64*1024;
const READ_MAX=1024*1024;
const METADATA_MAX=10000;
const TENSORS_MAX=200000;
const ARRAY_MAX=1000000;
const NUM_WIDTH=Object.freeze({0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8});

function safeCount(value,label){
  if(typeof value==='bigint'){
    if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Unsafe '+label);
    return Number(value);
  }
  if(!Number.isSafeInteger(value)||value<0)throw new Error('Unsafe '+label);
  return value;
}
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function hashMatches(actual,expected){
  return timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}

export async function openChunkModel(manifestPath){
  if(typeof manifestPath!=='string'||!manifestPath.trim())throw new Error('Explicit manifest path required');
  const path=resolve(manifestPath);
  const st=await lstat(path);
  if(!st.isFile()||st.size<16||st.size>8*1024*1024)throw new Error('Invalid chunk manifest size');
  let m;
  try{m=JSON.parse(await readFile(path,'utf8'));}catch{throw new Error('Invalid chunk manifest JSON');}
  if(m?.format!=='sol0-byte-chunks-v1'||m.version!==1||
    !Number.isSafeInteger(m.chunkBytes)||m.chunkBytes<1024||m.chunkBytes>CHUNK_MAX||
    !Number.isSafeInteger(m.totalBytes)||m.totalBytes<1||
    !SHA.test(m.sha256)||!Array.isArray(m.parts)||m.parts.length<1||
    m.parts.length>20000||m.parts.length!==Math.ceil(m.totalBytes/m.chunkBytes)){
    throw new Error('Invalid chunk manifest structure');
  }
  let sum=0;
  for(let i=0;i<m.parts.length;i++){
    const part=m.parts[i],expected='part-'+String(i).padStart(6,'0')+'.bin';
    if(typeof part?.name!=='string'||!PART_PATTERN.test(part.name)||
      part.name!==expected||basename(part.name)!==part.name||
      !Number.isSafeInteger(part.bytes)||part.bytes<=0||
      part.bytes!==(i===m.parts.length-1?m.totalBytes-sum:m.chunkBytes)||
      !SHA.test(part.sha256)){
      throw new Error('Unsafe chunk manifest entry');
    }
    sum+=part.bytes;
    if(!Number.isSafeInteger(sum))throw new Error('Chunk byte length overflow');
  }
  if(sum!==m.totalBytes)throw new Error('Chunk length mismatch');

  const root=dirname(path);
  let cacheIndex=-1, cache=null, chunkLoads=0;
  const touched=new Set();
  async function loadChunk(index){
    if(index===cacheIndex)return cache;
    const entry=m.parts[index];
    const file=join(root,entry.name);
    const info=await lstat(file);
    if(!info.isFile()||info.size!==entry.bytes)throw new Error('Missing or invalid model chunk');
    const bytes=await readFile(file);
    if(bytes.length!==entry.bytes||!hashMatches(sha256(bytes),entry.sha256)){
      throw new Error('Model chunk SHA256 mismatch: '+entry.name);
    }
    cacheIndex=index;cache=bytes;chunkLoads++;touched.add(index);
    return bytes;
  }
  async function readRange(start,length){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<0||
      length>READ_MAX||start<0||start>m.totalBytes-length){
      throw new Error('Lazy GGUF byte range outside model or 1MiB read cap');
    }
    const output=Buffer.allocUnsafe(length);
    let copied=0;
    while(copied<length){
      const offset=start+copied;
      const partNumber=Math.floor(offset/m.chunkBytes);
      const partOffset=offset-partNumber*m.chunkBytes;
      const chunk=await loadChunk(partNumber);
      const copy=Math.min(length-copied,chunk.length-partOffset);
      if(copy<=0)throw new Error('Chunk range gap');
      chunk.copy(output,copied,partOffset,partOffset+copy);
      copied+=copy;
    }
    return output;
  }
  return Object.freeze({
    readRange,totalBytes:m.totalBytes,chunkBytes:m.chunkBytes,
    partCount:m.parts.length,sourceSha256:m.sha256,
    get statistics(){return Object.freeze({
      partCount:m.parts.length,uniqueChunksRead:touched.size,
      chunkLoads, maxResidentChunkBytes:m.chunkBytes,
      diskReassembly:false
    });}
  });
}

class HeaderCursor{
  constructor(source){
    this.source=source;
    this.pos=0;
    this.limit=Math.min(HEADER_MAX,source.totalBytes);
    this.winStart=-1;
    this.win=Buffer.alloc(0);
  }
  async take(n){
    if(!Number.isSafeInteger(n)||n<0||this.pos+n>this.limit){
      throw new Error('GGUF header truncated or exceeds 48MiB cap');
    }
    if(n===0)return Buffer.alloc(0);
    if(this.pos<this.winStart||this.pos+n>this.winStart+this.win.length){
      this.winStart=this.pos;
      this.win=await this.source.readRange(this.pos,Math.min(WINDOW_BYTES,this.limit-this.pos));
    }
    if(n>this.win.length-(this.pos-this.winStart)){
      const raw=await this.source.readRange(this.pos,n);
      this.pos+=n;
      return raw;
    }
    const start=this.pos-this.winStart;
    const bytes=this.win.subarray(start,start+n);
    this.pos+=n;
    return bytes;
  }
  skip(n){
    if(!Number.isSafeInteger(n)||n<0||this.pos+n>this.limit){
      throw new Error('GGUF metadata length exceeds header cap');
    }
    this.pos+=n;
  }
  async u32(){return (await this.take(4)).readUInt32LE();}
  async u64(){return safeCount((await this.take(8)).readBigUInt64LE(),'GGUF u64');}
  async str(max=1024,keep=true){
    const len=await this.u64();
    if(len>max&&keep)throw new Error('GGUF string exceeds field limit');
    if(!keep){this.skip(len);return null;}
    return (await this.take(len)).toString('utf8');
  }
  async value(type,keep=false){
    if(type===8)return this.str(keep?128:1024,keep);
    if(type===9){
      const elementType=await this.u32(),count=await this.u64();
      if(count>ARRAY_MAX||elementType===9)throw new Error('Invalid GGUF array metadata');
      const width=NUM_WIDTH[elementType];
      if(width){
        this.skip(count*width);
      } else if(elementType===8){
        for(let i=0;i<count;i++)await this.str(1024,false);
      }else throw new Error('Unknown GGUF array element type');
      return null;
    }
    const width=NUM_WIDTH[type];
    if(!width)throw new Error('Unknown GGUF metadata type');
    const raw=await this.take(width);
    if(!keep)return null;
    switch(type){
      case 0:return raw.readUInt8();
      case 1:return raw.readInt8();
      case 2:return raw.readUInt16LE();
      case 3:return raw.readInt16LE();
      case 4:return raw.readUInt32LE();
      case 5:return raw.readInt32LE();
      case 6:return raw.readFloatLE();
      case 7:return raw[0]!==0;
      case 10:return safeCount(raw.readBigUInt64LE(),'GGUF metadata number');
      case 11:return Number(raw.readBigInt64LE());
      case 12:return raw.readDoubleLE();
      default:throw new Error('GGUF metadata primitive unsupported');
    }
  }
}
function align(value,bytes){return Math.ceil(value/bytes)*bytes;}
function product(values){
  let total=1;
  for(const v of values){
    total*=v;
    if(!Number.isSafeInteger(total))throw new Error('GGUF tensor shape too large');
  }
  return total;
}

/** Read only structural bytes: seek past tokenizer strings and tensor payloads. */
export async function indexChunkedGGUF(source){
  const cursor=new HeaderCursor(source);
  if((await cursor.take(4)).toString('ascii')!=='GGUF')throw new Error('GGUF magic missing');
  const version=await cursor.u32();
  if(version!==2&&version!==3)throw new Error('Unsupported GGUF version');
  const tensorCount=await cursor.u64(),metadataCount=await cursor.u64();
  if(tensorCount<1||tensorCount>TENSORS_MAX||metadataCount>METADATA_MAX){
    throw new Error('GGUF header counts out of range');
  }
  let architecture=null, alignment=32;
  for(let i=0;i<metadataCount;i++){
    const key=await cursor.str(1024);
    const type=await cursor.u32();
    const keep=key==='general.architecture'||key==='general.alignment';
    const value=await cursor.value(type,keep);
    if(key==='general.architecture')architecture=value;
    if(key==='general.alignment')alignment=value;
  }
  if(!/^qwen[0-9a-z]*$/.test(architecture??'')){
    throw new Error('Lazy prototype currently supports only Qwen GGUF headers');
  }
  if(!Number.isInteger(alignment)||alignment<8||alignment>65536||alignment%8!==0){
    throw new Error('Invalid GGUF alignment');
  }
  const tensors=new Map();
  for(let i=0;i<tensorCount;i++){
    const name=await cursor.str(64),rank=await cursor.u32();
    if(rank<1||rank>4||!name||tensors.has(name))throw new Error('Invalid GGUF tensor directory');
    const shape=[];
    for(let n=0;n<rank;n++){
      const dimension=await cursor.u64();
      if(dimension<1)throw new Error('Invalid GGUF tensor shape');
      shape.push(dimension);
    }
    const type=await cursor.u32(),offset=await cursor.u64();
    if(offset%alignment!==0)throw new Error('Unaligned GGUF tensor offset');
    tensors.set(name,Object.freeze({name,shape,type,offset,elements:product(shape)}));
  }
  const dataStart=align(cursor.pos,alignment);
  if(dataStart>source.totalBytes)throw new Error('GGUF tensor region outside model');
  return Object.freeze({
    architecture,version,alignment,dataStart,
    tensorCount,metadataCount,tensors,
    headerBytesRead:cursor.pos,
    assembledFileNeeded:false
  });
}

export function decodeF16(bits){
  const sign=(bits&0x8000)?-1:1;
  const exp=(bits>>>10)&31;
  const frac=bits&1023;
  if(exp===31)throw new Error('Unsupported nonfinite quantization scale');
  if(exp===0)return sign*Math.pow(2,-14)*(frac/1024);
  return sign*Math.pow(2,exp-15)*(1+frac/1024);
}

/**
 * Demonstrates an actual quantized weight dot-product straight from chunk files:
 * Q8_0 is 2-byte F16 scale followed by 32 int8 weights in each 34-byte block.
 * It is one primitive needed for inference, NOT a full transformer forward pass.
 */
export async function dotQ8ChunkBlock(source,index,{
  tensorName=null,blockIndex=0,vector=Array(32).fill(1)
}={}){
  if(!Array.isArray(vector)||vector.length!==32||
      !vector.every(x=>typeof x==='number'&&Number.isFinite(x))){
    throw new Error('Q8 dot product needs exactly 32 finite input values');
  }
  const selected=tensorName===null?
    [...index.tensors.values()].find(t=>t.type===8&&t.shape[0]%32===0):
    index.tensors.get(tensorName);
  if(!selected||selected.type!==8||selected.shape[0]%32!==0){
    throw new Error('Requested tensor is not GGML Q8_0');
  }
  const blocks=selected.elements/32;
  if(!Number.isSafeInteger(blockIndex)||blockIndex<0||blockIndex>=blocks){
    throw new Error('Q8 block index out of range');
  }
  const offset=index.dataStart+selected.offset+blockIndex*34;
  const bytes=await source.readRange(offset,34);
  const scale=decodeF16(bytes.readUInt16LE(0));
  let dot=0;
  const weights=[];
  for(let i=0;i<32;i++){
    const w=bytes.readInt8(i+2)*scale;
    weights.push(w);
    dot+=w*vector[i];
  }
  if(!Number.isFinite(dot))throw new Error('Nonfinite Q8 result');
  return Object.freeze({
    tensorName:selected.name,blockIndex,scale,dot,
    firstFourWeights:Object.freeze(weights.slice(0,4)),
    sourceOffset:offset,modelBytesRebuilt:0,
    kernel:'Q8_0 32-weight dot product'
  });
}
