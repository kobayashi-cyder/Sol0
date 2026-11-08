/**
 * Inspect and compute one real GGUF Q8_0 weight block directly from chunks.
 * No concatenation or full model materialization. NOT full token inference.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChunkModel, indexChunkedGGUF, dotQ8ChunkBlock } from './lazy_gguf.mjs';

export function parseLazyArgs(argv){
  const result=Object.create(null);
  for(const arg of argv){
    const m=/^--([a-z0-9-]+)=(.+)$/.exec(arg);
    if(!m||!['manifest','expected-sha256','tensor','block'].includes(m[1])
      ||Object.hasOwn(result,m[1]))throw new Error('Invalid or duplicated lazy GGUF argument');
    result[m[1]]=m[2];
  }
  if(!result.manifest)throw new Error('--manifest=... is required');
  const sha=result['expected-sha256']??null;
  if(sha!==null&&!/^[a-f0-9]{64}$/.test(sha)){
    throw new Error('Invalid --expected-sha256');
  }
  const block=result.block===undefined?0:Number(result.block);
  if(!Number.isSafeInteger(block)||block<0)throw new Error('--block must be nonnegative integer');
  const tensor=result.tensor??null;
  if(tensor!==null&&(tensor.length>64||!tensor.trim()))throw new Error('Invalid tensor name');
  return Object.freeze({manifest:result.manifest,expectedSha256:sha,tensor,block});
}

export async function computeLazyBlock(options){
  const source=await openChunkModel(options.manifest);
  if(options.expectedSha256!==null&&source.sourceSha256!==options.expectedSha256){
    throw new Error('Manifest whole-file SHA256 does not match trusted digest');
  }
  const index=await indexChunkedGGUF(source);
  const sample=await dotQ8ChunkBlock(source,index,{
    tensorName:options.tensor,blockIndex:options.block
  });
  const stats=source.statistics;
  if(stats.uniqueChunksRead===0||stats.uniqueChunksRead>stats.partCount)throw new Error('Invalid lazy I/O statistics');
  return Object.freeze({
    modelArchitecture:index.architecture,
    tensorCount:index.tensorCount,
    tensorName:sample.tensorName,
    blockIndex:sample.blockIndex,
    kernel:sample.kernel,
    numericDot:sample.dot,
    quantScale:sample.scale,
    sourceOffset:sample.sourceOffset,
    sampledValues:sample.firstFourWeights,
    modelFileBytes:source.totalBytes,
    sourceSha256:source.sourceSha256,
    chunksAvailable:stats.partCount,
    uniqueChunksRead:stats.uniqueChunksRead,
    chunksReloaded:stats.chunkLoads-stats.uniqueChunksRead,
    maxResidentChunkBytes:stats.maxResidentChunkBytes,
    diskReassembly:stats.diskReassembly,
    wholeModelRun:false,
    note:'Real quantized weight arithmetic from chunk files, not a Qwen text generation pass'
  });
}
async function main(){
  const result=await computeLazyBlock(parseLazyArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write('Lazy GGUF probe FAILED: '+error.message+'\n');
    process.exitCode=1;
  });
}
