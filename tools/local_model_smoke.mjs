/**
 * Explicit, public-prompt, loopback-only HTTP end-to-end inference check.
 * This calls a real local model server if one is running, and refuses remote
 * endpoints. It cannot certify factuality, bias or future model reliability.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InferenceRouter, createLocalProvider, createHTTPChatProvider,
  createNetworkPolicy
} from '../chat_web/inference_gateway.js';

export const PROBE_PROMPT = '接続試験です。短い日本語で一文だけ回答してください。 /no_think';

export function parseSmokeArgs(argv) {
  const options = Object.create(null);
  for (const arg of argv) {
    const m=/^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m || !['consent','endpoint','model'].includes(m[1])) {
      throw new Error('Unknown smoke test argument');
    }
    const [, key, val] = m;
    if (Object.hasOwn(options,key)) throw new Error('Duplicate smoke test argument');
    if (key==='consent') {
      if (val !== undefined) throw new Error('--consent takes no value');
      options.consent=true;
    } else {
      if (!val) throw new Error('Value required: '+key);
      options[key]=val;
    }
  }
  if (!options.consent) throw new Error('Explicit --consent is required');
  if (!options.endpoint || !options.model) throw new Error('--endpoint and --model are required');
  const url = new URL(options.endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !url.pathname.endsWith('/v1/chat/completions')
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Smoke test only permits exact 127.0.0.1 HTTP chat completion URLs');
  }
  return { endpoint:url.toString(), model:options.model, origin:url.origin };
}

export async function runLocalProbe(options, fetchImpl = globalThis.fetch, prompt = PROBE_PROMPT) {
  const remote = createHTTPChatProvider({
    endpoint:options.endpoint,
    modelRecord:{
      modelId:options.model,
      source:'user-configured localhost model (not audited)',
      license:'not verified by this probe'
    },
    networkPolicy:createNetworkPolicy({enabled:true,allowedOrigins:[options.origin]}),
    fetchImpl
  });
  const router = new InferenceRouter({
    localProvider:createLocalProvider(()=>{throw new Error('Probe must never fall back to WSP');}),
    remoteProvider:remote
  });
  const started=Date.now();
  const result=await router.generate(prompt,{route:'remote',consent:true});
  if (typeof result.text!=='string' || !result.text.trim()) throw new Error('Model reply was empty');
  return Object.freeze({
    model:options.model,
    elapsedMs:Date.now()-started,
    answerLength:result.text.length,
    preview:result.text.slice(0,240),
    providerId:result.providerId,
    fallback:result.fallback
  });
}

async function main() {
  const options=parseSmokeArgs(process.argv.slice(2));
  const output=await runLocalProbe(options);
  process.stdout.write(JSON.stringify({
    connected:true,
    model:output.model,
    elapsedMs:output.elapsedMs,
    answerLength:output.answerLength,
    answerPreview:output.preview,
    fallback:false,
    note:'Confirmed a response from configured local inference server, not model quality'
  },null,2)+'\n');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(err=>{
    process.stderr.write('Real model probe FAILED: '+err.message+'\n');
    process.exitCode=1;
  });
}
