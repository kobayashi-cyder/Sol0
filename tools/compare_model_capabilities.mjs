/**
 * One public capability question per invocation. Explicit consent and the
 * localhost-only restrictions from local_model_smoke apply to every call.
 * We never execute model-generated code or assign unreviewed quality scores.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSmokeArgs, runLocalProbe } from './local_model_smoke.mjs';

const CASE_FILE=new URL('../evaluations/local_capability_cases.json',import.meta.url);

export async function loadCapabilityCases() {
  const data=JSON.parse(await readFile(CASE_FILE,'utf8'));
  if(data.version!==1 || !Array.isArray(data.cases) || data.cases.length>20
    || data.cases.length===0 || new Set(data.cases.map(c=>c.id)).size!==data.cases.length) {
    throw new Error('Invalid capability benchmark schema');
  }
  for(const c of data.cases) {
    if(!/^[a-z_]{3,64}$/.test(c.id)
      || typeof c.prompt!=='string' || c.prompt.length>8000
      || !c.prompt.trim())throw new Error('Invalid capability question');
  }
  return data.cases;
}

export function parseCapabilityArgs(argv) {
  const caseArgs=argv.filter(a=>a.startsWith('--case='));
  if(caseArgs.length!==1 || caseArgs[0].length<9) {
    throw new Error('Provide exactly one --case=<caseId>, one prompt per consent');
  }
  const args=parseSmokeArgs(argv.filter(a=>!a.startsWith('--case=')));
  return Object.freeze({...args,caseId:caseArgs[0].slice('--case='.length)});
}

export async function evaluateOneCapability(options, {
  cases,fetchImpl=globalThis.fetch
}={}) {
  const all=cases??await loadCapabilityCases();
  const selected=all.find(c=>c.id===options.caseId);
  if(!selected) throw new Error('Unknown capability case: '+options.caseId);
  const response=await runLocalProbe(options,fetchImpl,selected.prompt);
  const exact=selected.expectedExact;
  const exactMatch=typeof exact==='string' ? response.answer.trim()===exact : null;
  return Object.freeze({
    model:options.model,
    caseId:selected.id,
    skill:selected.skill,
    response:response.answer,
    exactMatch,
    reference:typeof exact==='string'?exact:null,
    reviewStatus:'unreviewed',
    reminder:'Exact match is not overall model quality; validate answers with independent evidence'
  });
}

async function main() {
  const options=parseCapabilityArgs(process.argv.slice(2));
  const result=await evaluateOneCapability(options);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write('Local capability comparison: '+error.message+'\n');
    process.exitCode=1;
  });
}
