/**
 * Sol0-owned local Qwen entrypoint. Reads a user-supplied GGUF header, starts
 * an installed llama.cpp runner and serves the existing Sol0 UI on loopback.
 * It does NOT implement transformer inference, download weights or enable
 * network access in the Android APK.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { inspectGGUF, sha256File } from './gguf_inspect.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(ROOT, 'SolZero_Chat_Offline.html');
export const QWEN_ALIAS = 'sol0-qwen';
export const SUPPORTED_ARCHITECTURES = Object.freeze(['qwen2', 'qwen3', 'qwen3moe']);

function portNumber(value, name) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(name + ' must be an integer');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(name + ' must be between 1024 and 65535');
  }
  return port;
}

function boundedLayerCount(value, name) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(name + ' must be a nonnegative integer');
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 256) throw new Error(name + ' exceeds safe layer limits');
  return n;
}

export function parseArgs(argv) {
  const options = Object.create(null);
  for (const arg of argv) {
    const match = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error('Unknown argument: ' + arg);
    const [, key, value] = match;
    if (!['help', 'model', 'runner', 'port', 'ui-port', 'sha256', 'gpu-layers', 'cpu-moe-layers'].includes(key)) {
      throw new Error('Unknown argument: --' + key);
    }
    if (Object.hasOwn(options, key)) throw new Error('Duplicate argument: --' + key);
    if (key === 'help') {
      if (value !== undefined) throw new Error('--help takes no value');
      options.help = true;
      continue;
    }
    if (!value) throw new Error('--' + key + ' requires a value');
    options[key] = value;
  }
  if (options.help) return Object.freeze({ help: true });
  if (!options.model || !/\.gguf$/i.test(options.model)) {
    throw new Error('An explicit local --model=/path/model.gguf is required');
  }
  const port = portNumber(options.port ?? '9931', '--port');
  const uiPort = portNumber(options['ui-port'] ?? '8765', '--ui-port');
  if (port === uiPort) throw new Error('Model and UI ports must differ');
  const sha256 = options.sha256?.toLowerCase() ?? null;
  if (sha256 !== null && !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('--sha256 must contain 64 hexadecimal digits');
  }
  const runner = options.runner ?? 'llama-server';
  if (runner.startsWith('-') || runner.includes('\0')) throw new Error('Invalid runner path');
  return Object.freeze({
    model: resolve(options.model), runner, port, uiPort, sha256,
    gpuLayers: options['gpu-layers'] === undefined ? null : boundedLayerCount(options['gpu-layers'], '--gpu-layers'),
    cpuMoeLayers: options['cpu-moe-layers'] === undefined ? null : boundedLayerCount(options['cpu-moe-layers'], '--cpu-moe-layers')
  });
}

export function buildRunnerArgs({ model, port, uiPort, gpuLayers = null, cpuMoeLayers = null }) {
  return [
    '--model', model,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--alias', QWEN_ALIAS,
    '--ctx-size', '4096',
    ...(gpuLayers === null ? [] : ['--n-gpu-layers', String(gpuLayers)]),
    ...(cpuMoeLayers === null ? [] : ['--n-cpu-moe', String(cpuMoeLayers)]),
    '--cors-origins', 'http://127.0.0.1:' + uiPort,
    '--offline',
    '--no-webui'
  ];
}

/** Loopback-only static UI; never serves the repository tree or GGUF bytes. */
export async function startLocalUI({ port, htmlPath = HTML } = {}) {
  const html = await readFile(htmlPath);
  if (!html.includes(Buffer.from('<script type="module">'))) {
    throw new Error('Standalone Sol0 HTML has not been built');
  }
  const server = createServer((request, response) => {
    const actualPort = server.address().port;
    const hosts = ['127.0.0.1:' + actualPort, 'localhost:' + actualPort];
    if (!hosts.includes(request.headers.host)) {
      response.writeHead(403).end('Forbidden host');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (request.url === '/') {
      response.writeHead(302, { Location: '/SolZero_Chat_Offline.html' }).end();
      return;
    }
    if (request.url !== '/SolZero_Chat_Offline.html') {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    });
    response.end(request.method === 'HEAD' ? undefined : html);
  });
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolveListen);
    });
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}

export async function launchLocalQwen(options, dependencies = {}) {
  const inspect = dependencies.inspect ?? inspectGGUF;
  const hash = dependencies.hash ?? sha256File;
  const spawnRunner = dependencies.spawnRunner ?? spawn;
  const serveUI = dependencies.serveUI ?? startLocalUI;
  const metadata = await inspect(options.model);
  if (!SUPPORTED_ARCHITECTURES.includes(metadata.architecture)) {
    throw new Error('GGUF architecture is not Qwen-compatible: ' + metadata.architecture);
  }
  if (options.sha256 !== null) {
    const actual = await hash(options.model);
    if (actual !== options.sha256) throw new Error('GGUF SHA256 mismatch; refusing to start');
  }
  const ui = await serveUI({ port: options.uiPort });
  let child;
  try {
    child = spawnRunner(options.runner, buildRunnerArgs(options), {
      shell: false,
      stdio: 'inherit',
      windowsHide: true
    });
  } catch (error) {
    ui.close();
    throw error;
  }
  return { metadata, ui, child, sha256Verified: options.sha256 !== null };
}

export const HELP = [
  'Sol0 local Qwen GGUF runner (Node 22+; llama.cpp binary installed separately)',
  'node tools/qwen_local.mjs --model=/absolute/path/Qwen3-0.6B-Q4_K_M.gguf',
  'Optional: --runner=/path/to/llama-server --port=9931 --ui-port=8765',
  'Optional: --sha256=<known 64-hex SHA256> verifies the complete file before launch.',
  'Optional: --gpu-layers=0 puts layers on CPU (slow; RAM required).',
  'Optional: --cpu-moe-layers=N keeps N MoE expert layers on CPU (only MoE models).',
  'No model download, telemetry or cloud inference. Everything binds to 127.0.0.1.',
  'llama.cpp supplies the actual inference operations; Sol0 does not yet have',
  'its own native GGUF/Qwen tensor execution engine.',
  'The Android APK remains offline and does not run the model.'
].join('\n');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(HELP + '\n');
  const run = await launchLocalQwen(options);
  const modelEndpoint = 'http://127.0.0.1:' + options.port + '/v1/chat/completions';
  process.stdout.write([
    'Local GGUF architecture: ' + run.metadata.architecture,
    'Model name (metadata, not verified): ' + (run.metadata.modelName ?? 'unknown'),
    'Full SHA256 verified: ' + run.sha256Verified,
    'Sol0 UI: http://127.0.0.1:' + options.uiPort + '/SolZero_Chat_Offline.html',
    'Set Sol0 LLM endpoint: ' + modelEndpoint,
    'Set Sol0 model ID: ' + QWEN_ALIAS,
    'Enter the actual model source and license yourself.',
    'Use Sol0: LLM接続設定 -> 外部LLM（毎回確認）.',
    'No prompt is sent without Sol0 consent. Stop with Ctrl+C.'
  ].join('\n') + '\n');
  const shutdown = () => {
    run.ui.close();
    if (!run.child.killed) run.child.kill('SIGTERM');
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  run.child.once('error', error => {
    process.stderr.write('llama-server failed to start: ' + error.message + '\n');
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
    process.stderr.write('Qwen local runtime: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
