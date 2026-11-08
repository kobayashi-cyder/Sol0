import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {convertFile} from '../tools/export_wsp.mjs';
import {GRAPH_DEMO_NUMERIC} from '../chat_web/wsp_graph.js';

test('CLI exports Python and JavaScript WSP code and protects existing output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'solzero-wsp-cli-')),input=join(dir,'graph.json');
 writeFileSync(input,JSON.stringify(GRAPH_DEMO_NUMERIC));
 for(const lang of ['python','javascript']){
  const out=join(dir,lang==='python'?'predict.py':'predict.js');
  const report=convertFile([input,lang,out]);
  assert.equal(report.language,lang);
  assert.ok(report.bytes>1000);
  const code=readFileSync(out,'utf8');
  assert.match(code,/wsp_predict/);
  const exec=lang==='python'?
    spawnSync('python',['-c',code+'\nprint(wsp_predict([3,2]))'],{encoding:'utf8'}):
    spawnSync(process.execPath,['--input-type=commonjs','-e',code+'\nconsole.log(JSON.stringify(wsp_predict([3,2])))'],{encoding:'utf8'});
  assert.equal(exec.status,0,exec.stderr);
  assert.match(exec.stdout,/1/);
  assert.throws(()=>convertFile([input,lang,out]),/EEXIST/);
 }
});
test('CLI rejects unsupported languages, mismatched extensions, malformed files and requires explicit force',()=>{
 const dir=mkdtempSync(join(tmpdir(),'solzero-wsp-cli-bad-')),input=join(dir,'graph.json'),output=join(dir,'output.py');
 writeFileSync(input,JSON.stringify(GRAPH_DEMO_NUMERIC));
 assert.throws(()=>convertFile([input,'ruby',output]),/出力拡張子/);
 assert.throws(()=>convertFile([input,'python',join(dir,'bad.js')]),/出力拡張子/);
 assert.throws(()=>convertFile([input,'python',output,'--unexpected']),/Usage/);
 writeFileSync(input,'{"not":"a graph"}');
 assert.throws(()=>convertFile([input,'python',output]));
 assert.equal(existsSync(output),false);
});