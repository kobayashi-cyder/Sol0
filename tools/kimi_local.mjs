/**
 * Run user-supplied Kimi safetensors with an independently installed vLLM.
 * Sol0 never downloads model weights, enables Android internet permission,
 * or runs checkpoint-supplied Python without explicit opt-in.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectLocalKimiModel, verifyKimiShardHashes } from './kimi_model.mjs';
import { startLocalUI } from './qwen_local.mjs';

export const KIMI_ALIAS = 'sol0-kimi';

function port(value, name) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(name + ' must be an integer');
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) {
    throw new Error(name + ' must be between 1024 and 65535');
  }
  return n;
}
function positive(value, name, max) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(name + ' must be a positive integer');
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(name + ' is out of range');
  return n;
}

export function parseKimiArgs(argv) {
  const raw = Object.create(null);
  const keys = new Set([
    'model-dir', 'family', 'runner', 'port', 'ui-port',
    'max-model-len', 'tensor-parallel-size', 'allow-model-code', 'sha256-manifest', 'help'
  ]);
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (!m || !keys.has(m[1])) throw new Error('Unknown Kimi argument: ' + arg);
    const [, key, val] = m;
    if (Object.hasOwn(raw, key)) throw new Error('Duplicate Kimi argument: ' + key);
    if (key === 'help' || key === 'allow-model-code') {
      if (val !== undefined) throw new Error('Flag takes no value: ' + key);
      raw[key] = true;
    } else {
      if (!val) throw new Error('Missing value: ' + key);
      raw[key] = val;
    }
  }
  if (raw.help) return Object.freeze({ help: true });
  if (!raw['model-dir']) throw new Error('--model-dir=/absolute/local/checkpoint is required');
  const modelDir = resolve(raw['model-dir']);
  const modelPort = port(raw.port ?? '9932', '--port');
  const uiPort = port(raw['ui-port'] ?? '8766', '--ui-port');
  if (modelPort === uiPort) throw new Error('Model and UI ports must differ');
  const family = raw.family ?? 'auto';
  if (!['auto','kimi-dev'].includes(family)) throw new Error('Unsupported --family; use auto or kimi-dev');
  const runner = raw.runner ?? 'vllm';
  if (runner.startsWith('-') || runner.includes('\0')) throw new Error('Invalid vLLM runner path');
  return Object.freeze({
    modelDir, modelPort, uiPort, family, runner,
    allowModelCode: raw['allow-model-code'] === true,
    sha256Manifest: raw['sha256-manifest'] ? resolve(raw['sha256-manifest']) : null,
    maxModelLen: positive(raw['max-model-len'] ?? '4096','--max-model-len', 131072),
    tensorParallel: positive(raw['tensor-parallel-size'] ?? '1','--tensor-parallel-size', 64)
  });
}

export function buildVllmArgs(options) {
  const origins = 'http://127.0.0.1:' + options.uiPort;
  return [
    'serve', options.modelDir,
    '--host', '127.0.0.1',
    '--port', String(options.modelPort),
    '--served-model-name', KIMI_ALIAS,
    '--allowed-origins', origins,
    '--no-allow-credentials',
    '--max-model-len', String(options.maxModelLen),
    '--tensor-parallel-size', String(options.tensorParallel),
    ...(options.allowModelCode ? ['--trust-remote-code'] : [])
  ];
}

export function offlineVllmEnv(base = process.env) {
  return {
    ...base,
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_DATASETS_OFFLINE: '1',
    VLLM_NO_USAGE_STATS: '1',
    DO_NOT_TRACK: '1'
  };
}

export async function launchLocalKimi(options, dependencies = {}) {
  const inspect = dependencies.inspect ?? inspectLocalKimiModel;
  const serveUI = dependencies.serveUI ?? startLocalUI;
  const spawnRunner = dependencies.spawnRunner ?? spawn;
  const verifyHashes = dependencies.verifyHashes ?? verifyKimiShardHashes;
  const summary = await inspect(options.modelDir, {family:options.family});
  if (summary.requiresCustomCode && !options.allowModelCode) {
    throw new Error('Kimi model requests custom Python code. Review trusted local code and add --allow-model-code explicitly');
  }
  if (options.sha256Manifest) await verifyHashes(summary, options.sha256Manifest);
  const ui = await serveUI({port:options.uiPort});
  let child;
  try {
    child = spawnRunner(options.runner, buildVllmArgs(options), {
      shell:false, stdio:'inherit', windowsHide:true, env:offlineVllmEnv()
    });
  } catch (error) {
    ui.close();
    throw error;
  }
  return {ui, child, summary, hashesVerified: !!options.sha256Manifest};
}

export const KIMI_HELP = [
  'Sol0 Kimi local safetensors launcher (experimental; Node 22+, vLLM installed separately)',
  'node tools/kimi_local.mjs --model-dir=/absolute/path/to/Kimi-VL-A3B-Instruct --allow-model-code',
  'Optional: --runner=/path/to/vllm --family=auto --port=9932 --ui-port=8766',
  'Optional: --tensor-parallel-size=1 --max-model-len=4096',
  'Optional: --sha256-manifest=/path/to/hashes.json verifies all safetensors shards',
  'Kimi-Dev-72B uses qwen2 architecture; requires --family=kimi-dev.',
  '--allow-model-code explicitly authorizes model-supplied Python in the local checkpoint.',
  'Review it before using; this does NOT sandbox arbitrary Python.',
  'No model download or network inference. Runner, checkpoint and GPU are user supplied.',
  'The Android APK stays offline; neither Kimi weights nor vLLM are bundled.'
].join('\n');

async function main() {
  const options = parseKimiArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(KIMI_HELP + '\n');
  const run = await launchLocalKimi(options);
  process.stdout.write([
    'Kimi model config: ' + run.summary.modelType,
    'Safetensors shards inspected: ' + run.summary.headersChecked,
    'All shard SHA256 values matched supplied manifest: ' + run.hashesVerified,
    'vLLM starting; wait for its model-ready log before using Sol0.',
    'Sol0 UI: http://127.0.0.1:' + options.uiPort + '/SolZero_Chat_Offline.html',
    'Sol0 LLM endpoint: http://127.0.0.1:' + options.modelPort + '/v1/chat/completions',
    'Sol0 model ID: ' + KIMI_ALIAS,
    'Supply the verified checkpoint source and license in Sol0; every prompt requires consent.',
    'Ctrl+C to stop both processes.'
  ].join('\n') + '\n');
  const shutdown = () => {
    run.ui.close();
    if (!run.child.killed) run.child.kill('SIGTERM');
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  run.child.once('error', err => {
    process.stderr.write('Kimi vLLM startup failed: ' + err.message + '\n');
    shutdown();
    process.exitCode = 1;
  });
  run.child.once('exit', (code, signal) => {
    run.ui.close();
    process.exitCode = code === 0 || signal === 'SIGTERM' ? 0 : 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Kimi local runtime: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
