/**
 * Lossless, bounded-memory model byte splitting/reassembly.
 * Parts are storage transport only: the restored model still requires a
 * compatible inference runtime and sufficient working memory.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHUNK_LIMITS = Object.freeze({
  minBytes: 1024,
  maxBytes: 128 * 1024 * 1024,
  defaultBytes: 64 * 1024 * 1024,
  maxParts: 20000,
  maxManifestBytes: 8 * 1024 * 1024
});
const PART_NAME = /^part-(\d{6})\.bin$/;
const SHA256 = /^[0-9a-f]{64}$/;

function validateChunkSize(value) {
  if (!Number.isSafeInteger(value) || value < CHUNK_LIMITS.minBytes
      || value > CHUNK_LIMITS.maxBytes) {
    throw new Error('chunkBytes outside safe bounds');
  }
  return value;
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function sameHash(first, second) {
  return timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
}
function ensurePartName(name, i) {
  if (typeof name !== 'string' || !PART_NAME.test(name)
      || name !== 'part-' + String(i).padStart(6, '0') + '.bin') {
    throw new Error('Unsafe or nonsequential chunk filename');
  }
}
function validateManifest(manifest) {
  if (!manifest || manifest.format !== 'sol0-byte-chunks-v1'
      || manifest.version !== 1 || !Array.isArray(manifest.parts)
      || !manifest.parts.length || manifest.parts.length > CHUNK_LIMITS.maxParts
      || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 1
      || !SHA256.test(manifest.sha256)
      || !Number.isSafeInteger(manifest.chunkBytes)
      || manifest.chunkBytes < CHUNK_LIMITS.minBytes
      || manifest.chunkBytes > CHUNK_LIMITS.maxBytes) {
    throw new Error('Invalid model-chunk manifest');
  }
  let total = 0;
  for (const [i, part] of manifest.parts.entries()) {
    ensurePartName(part?.name, i);
    if (!Number.isSafeInteger(part.bytes) || part.bytes <= 0
        || part.bytes > manifest.chunkBytes || !SHA256.test(part.sha256)) {
      throw new Error('Invalid model-chunk length or checksum');
    }
    if (i < manifest.parts.length - 1 && part.bytes !== manifest.chunkBytes) {
      throw new Error('Only the final chunk may be short');
    }
    total += part.bytes;
    if (!Number.isSafeInteger(total)) throw new Error('Model byte count overflow');
  }
  if (total !== manifest.totalBytes) throw new Error('Model chunk byte count mismatch');
  if (typeof manifest.originalName !== 'string'
    || basename(manifest.originalName) !== manifest.originalName
    || !manifest.originalName || manifest.originalName.length > 250) {
    throw new Error('Invalid original filename metadata');
  }
  return manifest;
}

export async function splitModelBytes(source, partsDir, {
  chunkBytes = CHUNK_LIMITS.defaultBytes
} = {}) {
  validateChunkSize(chunkBytes);
  if (typeof source !== 'string' || !source.trim()
      || typeof partsDir !== 'string' || !partsDir.trim()) {
    throw new Error('Explicit model file and new parts directory are required');
  }
  const file = resolve(source), destDir = resolve(partsDir);
  const info = await lstat(file);
  if (!info.isFile() || info.size < 1 || !Number.isSafeInteger(info.size)) {
    throw new Error('Model source must be a nonempty regular file');
  }
  if (Math.ceil(info.size / chunkBytes) > CHUNK_LIMITS.maxParts) {
    throw new Error('Too many chunks; increase chunkBytes');
  }
  // Never overwrite a user directory; do not delete it on failure.
  await mkdir(destDir);
  const handle = await open(file, 'r');
  const totalHash = createHash('sha256'), parts = [];
  const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, info.size));
  try {
    let remaining = info.size;
    for (let i = 0; remaining > 0; i++) {
      const size = Math.min(remaining, chunkBytes);
      let got = 0;
      while (got < size) {
        const res = await handle.read(buffer, got, size - got, info.size - remaining + got);
        if (res.bytesRead === 0) throw new Error('Model file changed or was truncated while reading');
        got += res.bytesRead;
      }
      const chunk = buffer.subarray(0, size);
      const name = 'part-' + String(i).padStart(6, '0') + '.bin';
      const sha256 = digest(chunk);
      totalHash.update(chunk);
      await writeFile(join(destDir, name), chunk, {flag:'wx', mode:0o600});
      parts.push({name, bytes:size, sha256});
      remaining -= size;
    }
    const manifest = validateManifest({
      format:'sol0-byte-chunks-v1', version:1,
      originalName:basename(file), chunkBytes,
      totalBytes:info.size, sha256:totalHash.digest('hex'), parts
    });
    await writeFile(join(destDir, 'manifest.json'),
      JSON.stringify(manifest,null,2)+'\n', {flag:'wx',mode:0o600});
    return manifest;
  } finally { await handle.close(); }
}

export async function reassembleModelBytes(manifestPath, outputFile) {
  if (typeof manifestPath !== 'string' || !manifestPath.trim()
      || typeof outputFile !== 'string' || !outputFile.trim()) {
    throw new Error('Explicit manifest and new model output file are required');
  }
  const path = resolve(manifestPath), out = resolve(outputFile);
  const info = await lstat(path);
  if (!info.isFile() || info.size < 2 || info.size > CHUNK_LIMITS.maxManifestBytes) {
    throw new Error('Model-chunk manifest exceeds safe bounds');
  }
  let manifest;
  try { manifest = validateManifest(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { throw new Error('Cannot use model-chunk manifest: ' + error.message); }
  const partDir = dirname(path);
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, manifest.chunkBytes));
  const allHash = createHash('sha256');
  let destination, created = false;
  try {
    destination = await open(out, 'wx', 0o600); created = true;
    for (const part of manifest.parts) {
      const chunkPath = join(partDir, part.name);
      let partInfo;
      try { partInfo = await lstat(chunkPath); }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error('Model chunk missing or wrong length: ' + part.name);
        throw error;
      }
      if (!partInfo.isFile() || partInfo.size !== part.bytes) {
        throw new Error('Model chunk missing or wrong length: ' + part.name);
      }
      const input = await open(chunkPath, 'r');
      const partHash = createHash('sha256');
      try {
        let offset = 0;
        while (offset < part.bytes) {
          const want = Math.min(part.bytes - offset, buffer.length);
          const res = await input.read(buffer, 0, want, offset);
          if (res.bytesRead === 0) throw new Error('Model chunk truncated: ' + part.name);
          const bytes = buffer.subarray(0, res.bytesRead);
          partHash.update(bytes); allHash.update(bytes);
          let written = 0;
          while (written < bytes.length) {
            const w = await destination.write(bytes, written, bytes.length - written);
            if (!w.bytesWritten) throw new Error('Unable to write restored model');
            written += w.bytesWritten;
          }
          offset += res.bytesRead;
        }
      } finally { await input.close(); }
      if (!sameHash(partHash.digest('hex'), part.sha256)) {
        throw new Error('Model chunk checksum mismatch: ' + part.name);
      }
    }
    if (!sameHash(allHash.digest('hex'), manifest.sha256)) {
      throw new Error('Restored model SHA256 mismatch');
    }
    await destination.sync();
    return { outputFile:out, totalBytes:manifest.totalBytes, sha256:manifest.sha256,
      parts:manifest.parts.length, verified:true };
  } catch (error) {
    // Destination was created with wx, so it is safe to remove that partial file.
    if (destination) await destination.close();
    destination = null;
    if (created) await unlink(out).catch(()=>{});
    throw error;
  } finally { if (destination) await destination.close(); }
}

export function parseChunkArgs(args) {
  if (!['split','join'].includes(args[0])) throw new Error('Expected split or join');
  const command=args[0], values=Object.create(null);
  for (const arg of args.slice(1)) {
    const m=/^--([a-z-]+)=(.+)$/.exec(arg);
    if (!m || !['input','out','manifest','chunk-bytes'].includes(m[1])
        || Object.hasOwn(values,m[1])) throw new Error('Invalid or duplicate model-chunk option');
    values[m[1]]=m[2];
  }
  if (command==='split') {
    if (!values.input || !values.out || values.manifest) throw new Error('split requires --input and --out');
    const chunkBytes = values['chunk-bytes'] === undefined ? CHUNK_LIMITS.defaultBytes : Number(values['chunk-bytes']);
    validateChunkSize(chunkBytes);
    return {command,input:values.input,out:values.out,chunkBytes};
  }
  if (!values.manifest || !values.out || values.input || values['chunk-bytes']) {
    throw new Error('join requires --manifest and --out');
  }
  return {command,manifest:values.manifest,out:values.out};
}

async function main() {
  const options=parseChunkArgs(process.argv.slice(2));
  const result=options.command==='split'
    ? await splitModelBytes(options.input,options.out,{chunkBytes:options.chunkBytes})
    : await reassembleModelBytes(options.manifest,options.out);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write('Model chunk operation: '+error.message+'\n');process.exitCode=1;});
}
