import test from 'node:test';
import assert from 'node:assert/strict';
import {predictLearnedIntent,learnedNgrams,LEARNED_ROUTER_META} from '../chat_web/learned_router.js';
import {SolZeroEngine} from '../chat_web/engine.js';
test('scratch learned router: parameters and weights are present',()=>{
  assert.equal(LEARNED_ROUTER_META.parameters,24582);
  assert.equal(LEARNED_ROUTER_META.labels.length,6);
  assert.equal(LEARNED_ROUTER_META.weightsSha256.length,64);
});
test('distinct sentence forms infer class from quantized weights',()=>{
  const examples=[['計算問題です 18-8','calc'],['メモを記録して 開発ノート','memory'],
    ['未完了タスクを確認','task'],['この資料を検索 会話履歴','search'],
    ['WSPの回路を追加 数式','wsp'],['雑談を楽しみたい 買い物リスト','chat']];
  for(const [text,label] of examples){const pred=predictLearnedIntent(text);assert.equal(pred.label,label,`${text}: ${JSON.stringify(pred)}`);}
});
test('unicode normalization and deterministic hash',()=>{
  assert.deepEqual(learnedNgrams('計算 ＡＢＣ'),learnedNgrams('計算 ABC'));
  const v=predictLearnedIntent('資料検索して 計算');
  assert.equal(v.label,predictLearnedIntent('資料検索して 計算').label);
  assert.ok(v.ranked.every(x=>Number.isFinite(x.score)));
  assert.ok(Math.abs(v.ranked.reduce((s,x)=>s+x.score,0)-1)<1e-10);
});
test('intent status visible as chat command but no side-effect',()=>{
  const eng=new SolZeroEngine();
  assert.match(eng.reply('/learner'),/24,582|24582/);
  assert.match(eng.reply('/intent 資料から探して 仕様書'),/学習済み重みの分類/);
});
