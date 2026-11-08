import test from 'node:test';
import assert from 'node:assert/strict';
import {WeightRouter, SolZeroEngine, calculate, similarity, findLesson, saveLesson, ENGINE_VERSION} from '../chat_web/engine.js';
const state=()=>({messages:[],notes:[],lessons:[],tasks:[]});
test('zero-pretrained explicit WSP classification, edit, rollback and audit',()=>{
  const router=new WeightRouter();
  assert.equal(router.predict('こんにちは').intent,'greeting');
  assert.equal(router.predict('ありがとう').intent,'gratitude');
  const p=router.edit('identity','gratitude',12);
  assert.deepEqual([p.before,p.after],[0,12]);
  assert.equal(router.predict('ありがとう').intent,'identity');
  assert.equal(router.rollback(),true);
  assert.equal(router.predict('ありがとう').intent,'gratitude');
  assert.equal(router.rollback(),false);
  assert.throws(()=>router.edit('identity','greeting',Infinity));
  assert.throws(()=>router.edit('identity','greeting',101));
  assert.equal(router.restore({weights:[[1]]}),false);
  const snapshot=router.snapshot();
  const second=new WeightRouter();assert.equal(second.restore(snapshot),true);
  assert.deepEqual(second.weights,router.weights);
  router.edit('identity','gratitude',9);
  const third=new WeightRouter();assert.equal(third.restore(router.snapshot()),true);
  assert.equal(third.predict('ありがとう').intent,'identity');
  assert.equal(third.rollback(),true);assert.equal(third.predict('ありがとう').intent,'gratitude');
});
test('expression parser is bounded and does not evaluate JS',()=>{
  assert.equal(calculate('計算して (12+8)/4').value,'5');
  assert.equal(calculate('2+3×4').value,'14');
  assert.equal(calculate('0-2*3').value,'-6');
  assert.equal(calculate('8/0').error,'ゼロでは割れません。');
  assert.equal(calculate('process.exit()'),null);
  assert.equal(calculate('1+2;alert(1)'),null);
  assert.equal(calculate('('.repeat(48)+'1'+')'.repeat(48)).error,'計算式を確認してください。');
});
test('memory add/read/remove and character counting',()=>{
  const e=new SolZeroEngine(),s=state();
  assert.match(e.reply('覚えて：今日は実験日',s),/保存しました/);
  assert.match(e.reply('覚えていること',s),/今日は実験日/);
  assert.match(e.reply('忘れて：今日は実験日',s),/削除しました/);
  assert.match(e.reply('覚えていること',s),/メモはありません/);
  assert.match(e.reply('/count あいう',s),/3文字/);
});
test('tasks are isolated between conversations and can be completed/undone/deleted',()=>{
  const e=new SolZeroEngine(),s=state(),other=state();
  assert.match(e.reply('/todo ドキュメント確認',s),/追加しました/);
  assert.equal(s.tasks.length,1);
  assert.match(e.reply('/tasks',s),/☐ ドキュメント確認/);
  assert.match(e.reply('/done 1',s),/☑ ドキュメント確認/);
  assert.match(e.reply('/undo 1',s),/☐ ドキュメント確認/);
  assert.match(e.reply('/tasks',other),/タスクはありません/);
  assert.match(e.reply('/deltask 1',s),/タスクはありません/);
});
test('per-chat and shared taught Q&A without pretrained embeddings',()=>{
  const e=new SolZeroEngine(),a=state(),b=state(),knowledge=[];
  assert.match(e.reply('教える：今日の合言葉は？ => みずいろ',a,{knowledge}),/この会話/);
  assert.equal(e.reply('今日の合言葉は？',a,{knowledge}),'みずいろ');
  assert.notEqual(e.reply('今日の合言葉は？',b,{knowledge}),'みずいろ');
  e.reply('/teach 鳥取県の県庁所在地はどこですか？ => 鳥取市',a,{knowledge});
  assert.equal(knowledge.length,1);
  assert.equal(e.reply('鳥取県の県庁所在地はどこですか？',b,{knowledge}),'鳥取市');
  assert.match(e.reply('鳥取県の県庁所在地はどこ？',b,{knowledge}),/鳥取市/);
  assert.equal(saveLesson(knowledge,'鳥取県の県庁所在地はどこですか？','鳥取市です。'),'updated');
  assert.equal(knowledge.length,1);
  assert.equal(e.reply('鳥取県の県庁所在地はどこですか？',b,{knowledge}),'鳥取市です。');
  e.reply('学習削除：今日の合言葉は？',a,{knowledge});
  assert.equal(a.lessons.length,0);
});
test('false match abstains when questions are unrelated',()=>{
  assert.equal(similarity('鳥取県','電子回路'),0);
  assert.ok(similarity('鳥取県の県庁所在地はどこ？','鳥取県の県庁所在地はどこですか？')>.6);
  assert.equal(findLesson('深海の地理',[{q:'散歩の方法',a:'歩く'}]).score,0);
  const e=new SolZeroEngine();
  assert.match(e.reply('XQ-98惑星の人口は？'),/まだ自由回答できません/);
  assert.match(e.reply('あなたは誰ですか'),/学習済みモデルは使用していません/);
});
test('correction saves previous user prompt to shared memory',()=>{
  const e=new SolZeroEngine(),ctx={knowledge:[]},s=state();
  s.messages=[{role:'user',text:'私の研究コードは？',at:''},{role:'assistant',text:'未学習です',at:''}];
  assert.match(e.reply('修正：SOL001',s,ctx),/共有知識へ登録/);
  assert.equal(e.reply('私の研究コードは？',state(),ctx),'SOL001');
});
test('local document search returns filenames and real line numbers',()=>{
  const e=new SolZeroEngine(),ctx={documents:[{title:'manual.md',text:'1行目\n発火条件：温度が上がる\n故障時は再試行'}]};
  assert.match(e.reply('/search 発火条件',state(),ctx),/manual.md 2行目/);
  assert.match(e.reply('/search 未登録の文字列',state(),ctx),/文字列一致はありません/);
  assert.match(e.reply('/docs',state(),ctx),/manual.md/);
});
test('plain transcript excerpt does not claim model summarization',()=>{
  const e=new SolZeroEngine(),s=state();s.messages=[{role:'user',text:'こんにちは研究室',at:''}];
  assert.match(e.reply('履歴',s),/自動要約ではなく抜粋/);
  assert.match(e.reply('履歴',s),/こんにちは研究室/);
});
test('engine version and help reflect available operations',()=>{
  const e=new SolZeroEngine();
  assert.equal(ENGINE_VERSION,'0.15.0');
  assert.match(e.reply('/help'),/\/teach/);
  assert.match(e.reply('/help'),/一般推論・画像理解は未搭載/);
});
