/**
 * Safetensors header inspection for local Kimi checkpoints.
 * This checks file structure and shard presence without mapping the huge
 * weight payload into memory. It does not authenticate pretrained weights.
 */
import { open, readdir, stat, lstat, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

export const KIMI_LIMITS = Object.freeze({
  configBytes: 256 * 1024,
  indexBytes: 16 * 1024 * 1024,
  headerBytes: 32 * 1024 * 1024,
  files: 2048,
  tensors: 300000
});

const MODEL_TYPES = Object.freeze(new Set([
  'kimi_vl', 'kimi_k2', 'kimi_k25', 'kimi_linear'
]));

function jsonObject(bytes, label) {
  let object;
  try { object = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(label + ' is not valid JSON'); }
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new Error(label + ' must contain a JSON object');
  }
  return object;
}

async function readSmall(path, max, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.size > max || info.size < 2) {
    throw new Error(label + ' must be a regular file within size bounds');
  }
  return readFile(path);
}

async function readExact(handle, length, offset) {
  const buffer = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const chunk = await handle.read(buffer, got, length - got, offset + got);
    if (chunk.bytesRead === 0) throw new Error('Truncated safetensors header');
    got += chunk.bytesRead;
  }
  return buffer;
}

export async function inspectSafetensorsFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.size < 10) {
    throw new Error('Safetensors shard is missing or invalid');
  }
  const handle = await open(path, 'r');
  try {
    const sizeBytes = await readExact(handle, 8, 0);
    const raw = sizeBytes.readBigUInt64LE(0);
    if (raw < 2n || raw > BigInt(KIMI_LIMITS.headerBytes)) {
      throw new Error('Safetensors JSON header exceeds safe bounds');
    }
    const headerLength = Number(raw);
    if (headerLength + 8 > info.size) throw new Error('Safetensors header is truncated');
    const header = jsonObject(await readExact(handle, headerLength, 8), 'Safetensors header');
    const payload = info.size - headerLength - 8;
    let tensors = 0;
    const regions = [];
    for (const [name, entry] of Object.entries(header)) {
      if (name === '__metadata__') continue;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.dtype !== 'string'
        || !/^[A-Z0-9_]{2,24}$/.test(entry.dtype)
        || !Array.isArray(entry.shape)
        || entry.shape.length > 16
        || !entry.shape.every(n => Number.isSafeInteger(n) && n >= 0)
        || !Array.isArray(entry.data_offsets) || entry.data_offsets.length !== 2) {
        throw new Error('Invalid safetensors tensor descriptor');
      }
      const [start, end] = entry.data_offsets;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || end < start || end > payload) {
        throw new Error('Safetensors tensor offset exceeds file bounds');
      }
      regions.push([start, end]);
      if (++tensors > KIMI_LIMITS.tensors) throw new Error('Too many safetensors entries');
    }
    if (tensors < 1) throw new Error('Empty safetensors tensor header');
    regions.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < regions.length; i++) {
      if (regions[i][0] < regions[i - 1][1]) throw new Error('Overlapping safetensors tensors');
    }
    return Object.freeze({ tensorCount: tensors, headerBytes: headerLength, fileBytes: info.size });
  } finally {
    await handle.close();
  }
}

export async function inspectLocalKimiModel(directory, { family = 'auto' } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('Local model directory required');
  const modelDir = resolve(directory);
  const info = await stat(modelDir);
  if (!info.isDirectory()) throw new Error('Model path must be a local directory');
  const config = jsonObject(
    await readSmall(join(modelDir, 'config.json'), KIMI_LIMITS.configBytes, 'Kimi config.json'),
    'Kimi config.json'
  );
  const modelType = config.model_type;
  const isKimiDev = family === 'kimi-dev' && modelType === 'qwen2'
    && Array.isArray(config.architectures)
    && config.architectures.includes('Qwen2ForCausalLM');
  if (!MODEL_TYPES.has(modelType) && !isKimiDev) {
    throw new Error('Model architecture is not recognized as Kimi; Kimi-Dev needs --family=kimi-dev');
  }
  if (!['auto','kimi-dev'].includes(family) || (family === 'kimi-dev' && !isKimiDev)) {
    throw new Error('Kimi family selector does not match model config');
  }
  const contents = await readdir(modelDir, {withFileTypes:true});
  const names = contents.filter(f => f.isFile() && f.name.endsWith('.safetensors'))
    .map(f => f.name).sort();
  if (!names.length || names.length > KIMI_LIMITS.files) {
    throw new Error('Local Kimi model requires a bounded number of safetensors shards');
  }
  const indexPath = join(modelDir, 'model.safetensors.index.json');
  const indexEntry = contents.find(f => f.name === 'model.safetensors.index.json');
  if (indexEntry) {
    const index = jsonObject(
      await readSmall(indexPath, KIMI_LIMITS.indexBytes, 'safetensors index'),
      'safetensors index'
    );
    if (!index.weight_map || typeof index.weight_map !== 'object' || Array.isArray(index.weight_map)) {
      throw new Error('Safetensors index is missing weight_map');
    }
    const referenced = new Set(Object.values(index.weight_map));
    if (!referenced.size || referenced.size > KIMI_LIMITS.files) {
      throw new Error('Safetensors shard index count out of range');
    }
    const files = new Set(names);
    for (const name of referenced) {
      if (typeof name !== 'string' || basename(name) !== name
        || !/^[A-Za-z0-9_.-]+\.safetensors$/.test(name) || !files.has(name)) {
        throw new Error('Safetensors index references a missing or unsafe shard name');
      }
    }
  }
  let modelBytes = 0;
  let verifiedHeaders = 0;
  for (const name of names) {
    const summary = await inspectSafetensorsFile(join(modelDir, name));
    modelBytes += summary.fileBytes;
    verifiedHeaders++;
  }
  return Object.freeze({
    modelDir, modelType, family: isKimiDev ? 'kimi-dev' : modelType,
    architecture: config.architectures?.[0] ?? null,
    requiresCustomCode: !!(config.auto_map && Object.keys(config.auto_map).length),
    shards: names.length, headersChecked: verifiedHeaders,
    modelBytes, weightsAuthenticated: false
  });
}
