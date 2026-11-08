/**
 * Optional developer CLI. Existing Sol0 offline UI and Android APK are unchanged.
 * Input comes from stdin to avoid putting conversation text in shell arguments.
 * No credentials, model weights, telemetry, or network access by default.
 */
import { pathToFileURL } from 'node:url';
import { SolZeroEngine } from '../chat_web/engine.js';
import {
  INFERENCE_LIMITS, InferenceRouter, createWSPProvider,
  createHTTPChatProvider, createNetworkPolicy
} from '../chat_web/inference_gateway.js';

const KEY_ARGS = new Set(['endpoint', 'allow-origin', 'model', 'source', 'license']);
const FLAG_ARGS = new Set(['remote', 'consent', 'help']);

export function parseCliArgs(argv) {
  const args = Object.create(null);
  for (const raw of argv) {
    if (typeof raw !== 'string' || !raw.startsWith('--')) throw new Error('Unknown argument');
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw);
    if (!match) throw new Error('Unknown argument');
    const [, key, value] = match;
    if (Object.hasOwn(args, key)) throw new Error('Duplicate argument: ' + key);
    if (FLAG_ARGS.has(key)) {
      if (value !== undefined) throw new Error('Switch cannot have a value: ' + key);
      args[key] = true;
    } else if (KEY_ARGS.has(key)) {
      if (!value) throw new Error('Argument requires a value: ' + key);
      args[key] = value;
    } else {
      throw new Error('Unknown argument: ' + key);
    }
  }
  if (args.help) return { help: true };
  if (!args.remote && Object.keys(args).length) {
    throw new Error('Remote parameters require --remote');
  }
  if (args.remote) {
    for (const key of ['endpoint', 'allow-origin', 'model', 'source', 'license']) {
      if (!args[key]) throw new Error('Missing --' + key);
    }
    if (!args.consent) throw new Error('Remote request requires --consent');
  }
  return args;
}

export const USAGE = [
  'Local WSP: printf "こんにちは" | node tools/inference_cli.mjs',
  'Remote (explicit approval of loopback server):',
  'printf "こんにちは" | node tools/inference_cli.mjs --remote --consent',
  '  --endpoint=http://127.0.0.1:1234/v1/chat/completions',
  '  --allow-origin=http://127.0.0.1:1234',
  '  --model=my-local-model --source=user-installed --license=user-verified',
  'All remote arguments must appear on one shell command line.',
  'A local OpenAI-compatible inference server must already be running.',
  'This is a developer CLI, not an Android or app.js integration.'
].join('\n');

export async function runInferenceText(prompt, args, fetchImpl = globalThis.fetch) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > INFERENCE_LIMITS.inputChars) {
    throw new Error('Prompt is empty or exceeds the configured limit');
  }
  const engine = new SolZeroEngine();
  const state = { messages: [], notes: [], lessons: [], tasks: [] };
  const local = createWSPProvider(engine, {
    getState: () => state,
    getContext: () => ({ knowledge: [] })
  });
  if (!args.remote) {
    const router = new InferenceRouter({ localProvider: local });
    return (await router.generate(prompt)).text;
  }
  const remote = createHTTPChatProvider({
    endpoint: args.endpoint,
    modelRecord: {
      modelId: args.model,
      source: args.source,
      license: args.license,
      sha256: null
    },
    networkPolicy: createNetworkPolicy({
      enabled: true,
      allowedOrigins: [args['allow-origin']]
    }),
    fetchImpl
  });
  const router = new InferenceRouter({ localProvider: local, remoteProvider: remote });
  return (await router.generate(prompt, { route: 'remote', consent: args.consent === true })).text;
}

async function readPrompt() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk.toString('utf8');
    if (text.length > INFERENCE_LIMITS.inputChars) throw new Error('Prompt is too large');
  }
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    if (args.help) process.stdout.write(USAGE + '\n');
    else process.stdout.write(await runInferenceText(await readPrompt(), args) + '\n');
  } catch (error) {
    process.stderr.write('Inference CLI: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
