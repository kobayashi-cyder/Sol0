import test from 'node:test';
import assert from 'node:assert/strict';
import {SolZeroEngine,ENGINE_VERSION} from '../chat_web/engine.js';
import {WSPGraph,GRAPH_DEMO_NUMERIC} from '../chat_web/wsp_graph.js';
test('chat exposes validated deterministic coding and accurate media status',()=>{
 const e=new SolZeroEngine();
 assert.equal(ENGINE_VERSION,'0.15.0');
 const js=e.reply('/code javascript factorial');
 assert.match(js,/function factorial/);
 assert.match(js,/factorial\.js/);
 const py=e.reply('/code python fibonacci');
 assert.match(py,/def fibonacci/);
 assert.match(e.reply('/code python unknown'),/対応アルゴリズム/);
 assert.match(e.reply('/code help'),/二分探索/);
 assert.match(e.reply('/help'),/\/code/);
 assert.match(e.reply('画像を作成したい'),/手続き的生成/);
});

test('chat exports the current WSP graph to executable Python/JavaScript and rejects other languages',()=>{
 const e=new SolZeroEngine();e.graph=new WSPGraph(GRAPH_DEMO_NUMERIC);
 const py=e.reply('/exportwsp python');
 assert.match(py,/def wsp_predict\(inputs\):/);
 assert.match(py,/solzero_wsp.py/);
 const js=e.reply('/exportwsp javascript');
 assert.match(js,/function wsp_predict\(inputs\)/);
 assert.match(js,/solzero_wsp.js/);
 assert.match(e.reply('/exportwsp ruby'),/WSPコード出力を拒否/);
 assert.match(e.reply('/help'),/\/exportwsp/);
});
