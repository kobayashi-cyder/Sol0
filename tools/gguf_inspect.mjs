/**
 * Inspect local GGUF bytes without loading model tensors or making network calls.
 * Header metadata is not proof that the model weights are intact or trusted.
 */
import { open, stat, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export const MAX_GGUF_METADATA_BYTES = 48 * 1024 * 1024;
const MAX_METADATA_KEYS = 10000;
const MAX_TOKENS_PER_ARRAY = 1000000;
const WANTED_KEYS = new Set([
  'general.architecture', 'general.name', 'general.file_type',
  'general.quantization_version',
  'tokenizer.ggml.model', 'tokenizer.chat_template',
  'qwen3.block_count', 'qwen3.context_length',
  'qwen2.block_count', 'qwen2.context_length'
]);

export function parseGGUFMetadata(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('GGUF header must be bytes');
  let pos = 0;
  function take(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - pos) {
      throw new Error('GGUF metadata is truncated or outside the allowed header range');
    }
    const start = pos;
    pos += length;
    return start;
  }
  function number(size, method) {
    return bytes[method](take(size));
  }
  function count64() {
    const value = number(8, 'readBigUInt64LE');
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsafe GGUF length');
    return Number(value);
  }
  function str() {
    const len = count64();
    const start = take(len);
    return bytes.toString('utf8', start, pos);
  }
  function value(type, keep, depth = 0) {
    if (depth > 1) throw new Error('Nested GGUF array is unsupported');
    switch (type) {
      case 0: return number(1, 'readUInt8');
      case 1: return number(1, 'readInt8');
      case 2: return number(2, 'readUInt16LE');
      case 3: return number(2, 'readInt16LE');
      case 4: return number(4, 'readUInt32LE');
      case 5: return number(4, 'readInt32LE');
      case 6: return number(4, 'readFloatLE');
      case 7: return number(1, 'readUInt8') !== 0;
      case 8: return keep ? str() : (str(), null);
      case 9: {
        const elementType = number(4, 'readUInt32LE');
        const count = count64();
        if (count > MAX_TOKENS_PER_ARRAY || elementType === 9) {
          throw new Error('Unsupported GGUF array size or nested type');
        }
        if (keep) throw new Error('Array metadata is not supported as selected field');
        for (let i = 0; i < count; i++) value(elementType, false, depth + 1);
        return null;
      }
      case 10: return count64();
      case 11: {
        const n = number(8, 'readBigInt64LE');
        if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) {
          throw new Error('Unsafe GGUF signed integer');
        }
        return Number(n);
      }
      case 12: return number(8, 'readDoubleLE');
      default: throw new Error('Unknown GGUF metadata type: ' + type);
    }
  }
  if (bytes.length < 24 || bytes.toString('ascii', take(4), pos) !== 'GGUF') {
    throw new Error('Missing GGUF magic bytes');
  }
  const version = number(4, 'readUInt32LE');
  if (![2, 3].includes(version)) throw new Error('Unsupported GGUF version: ' + version);
  const tensorCount = count64();
  const keyCount = count64();
  if (keyCount > MAX_METADATA_KEYS || tensorCount > 200000) {
    throw new Error('Unreasonable GGUF header counts');
  }
  const metadata = Object.create(null);
  for (let i = 0; i < keyCount; i++) {
    const key = str();
    if (key.length > 1000) throw new Error('GGUF metadata key is too long');
    const type = number(4, 'readUInt32LE');
    const keep = WANTED_KEYS.has(key);
    const parsed = value(type, keep);
    if (keep) metadata[key] = parsed;
  }
  const architecture = metadata['general.architecture'];
  if (typeof architecture !== 'string' || !architecture.trim()) {
    throw new Error('GGUF architecture metadata is missing');
  }
  return Object.freeze({
    format: 'GGUF', version, tensorCount, metadataKeyCount: keyCount,
    architecture,
    modelName: typeof metadata['general.name'] === 'string' ? metadata['general.name'].slice(0, 200) : null,
    fileType: metadata['general.file_type'] ?? null,
    tokenizer: typeof metadata['tokenizer.ggml.model'] === 'string' ? metadata['tokenizer.ggml.model'] : null,
    hasChatTemplate: typeof metadata['tokenizer.chat_template'] === 'string',
    blockCount: metadata[architecture + '.block_count'] ?? null,
    contextLength: metadata[architecture + '.context_length'] ?? null,
    metadataBytes: pos,
    weightsVerified: false
  });
}

export async function inspectGGUF(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Explicit model file path is required');
  const file = await stat(filePath);
  if (!file.isFile() || file.size < 24) throw new Error('GGUF model must be a regular nonempty file');
  const length = Math.min(file.size, MAX_GGUF_METADATA_BYTES);
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(buffer, read, length - read, read);
      if (result.bytesRead === 0) break;
      read += result.bytesRead;
    }
    const parsed = parseGGUFMetadata(buffer.subarray(0, read));
    return Object.freeze({ ...parsed, fileBytes: file.size });
  } finally {
    await handle.close();
  }
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
