#!/usr/bin/env node
/** Offline CLI exporter for validated Sol-Zero numeric WSP graphs.
 * Does not execute the graph's contents as code and never contacts a network.
 */
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateWSPCode,WSP_EXPORT_LIMIT} from '../chat_web/wsp_codegen.js';

const usage='Usage: node tools/export_wsp.mjs input_graph.json python|javascript output.py|output.js [--force]';
export function convertFile(args) {
  if(!Array.isArray(args)||(args.length!==3&&args.length!==4)||
     (args.length===4&&args[3]!=='--force'))throw Error(usage);
  const [input,language,output]=args;
  if(typeof input!=='string'||typeof language!=='string'||typeof output!=='string')throw Error(usage);
  const expected=language==='python'?'.py':language==='javascript'?'.js':null;
  if(!expected||extname(output).toLowerCase()!==expected)throw Error('出力拡張子と言語を一致させてください（.py / .js）。');
  const path=resolve(input);
  // Prevent loading enormous/untrusted files before WSPGraph structural validation.
  if(statSync(path).size>WSP_EXPORT_LIMIT*2)throw Error('入力JSONサイズが上限を超えました。');
  const raw=JSON.parse(readFileSync(path,'utf8'));
  const result=generateWSPCode(raw,language);
  // Exclusive write preserves existing files unless the user deliberately opts in.
  writeFileSync(resolve(output),result.code,{encoding:'utf8',flag:args[3]==='--force'?'w':'wx'});
  return {file:resolve(output),language:result.language,nodes:result.nodes,weights:result.weights,bytes:Buffer.byteLength(result.code)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=convertFile(process.argv.slice(2));process.stdout.write(JSON.stringify(report)+'\n');}
  catch(err){process.stderr.write('WSP export rejected: '+err.message+'\n');process.exitCode=1;}
}