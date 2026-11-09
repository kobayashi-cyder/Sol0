/**
 * Parse official Kimi config.json without downloading weights or executing
 * model-supplied Python. This verifies metadata compatibility only.
 */
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectKimiConfiguration, KIMI_LIMITS } from './kimi_model.mjs';

export function parseConfigArgs(argv) {
  const config = Object.create(null);
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || !['config', 'family', 'expect'].includes(match[1])
        || Object.hasOwn(config, match[1])) {
      throw new Error('Invalid or duplicate Kimi config option');
    }
    config[match[1]] = match[2];
  }
  if (!config.config || !config.expect) {
    throw new Error('Explicit --config and --expect model type are required');
  }
  if (!['kimi_vl','kimi_k2','kimi_k25','kimi_linear','qwen2'].includes(config.expect)) {
    throw new Error('Unexpected Kimi model type');
  }
  const family = config.family ?? (config.expect === 'qwen2' ? 'kimi-dev' : 'auto');
  if (!['auto','kimi-dev'].includes(family)) throw new Error('Unsupported family');
  return Object.freeze({
    file: resolve(config.config),
    expectedType: config.expect,
    family
  });
}

export async function inspectKimiConfigFile(options) {
  const file = await lstat(options.file);
  if (!file.isFile() || file.size < 2 || file.size > KIMI_LIMITS.configBytes) {
    throw new Error('Kimi config file is not a bounded regular file');
  }
  let config;
  try { config = JSON.parse(await readFile(options.file, 'utf8')); }
  catch { throw new Error('Kimi config JSON is invalid'); }
  const summary = inspectKimiConfiguration(config, {family: options.family});
  if (summary.modelType !== options.expectedType) throw new Error('Unexpected publisher model type');
  return summary;
}

async function main() {
  const args = parseConfigArgs(process.argv.slice(2));
  const summary = await inspectKimiConfigFile(args);
  process.stdout.write(JSON.stringify({
    ...summary,
    source: 'user-supplied local config.json (publisher origin not cryptographically verified)',
    weightsDownloaded: false,
    inferenceExecuted: false
  }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Kimi metadata-only probe FAILED: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
