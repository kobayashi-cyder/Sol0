import test from 'node:test';
import assert from 'node:assert/strict';
import {ScratchBigram} from '../chat_web/bigram.js';
import {SolZeroEngine,retrieveEvidence} from '../chat_web/engine.js';

test('scratch softmax predictor reduces training loss, with reproducible output',()=>{
  const model=new ScratchBigram();
  const corpus='あいうえお。あいうえお。あいうえお。あいうえお。'.repeat(4);
  const r=model.train(corpus,7);
  assert.ok(r.after.loss<r.before.loss,{before:r.before,after:r.after});
  assert.ok(model.size>=6 && model.size<96);
  assert.ok(model.generate('あ',60).length===60);
  assert.equal(model.generate('あ',60,9),model.generate('あ',60,9));
});
test('held-out evaluation includes coverage and abstains for unknown alphabet',()=>{
  const m=new ScratchBigram();m.train('春夏秋冬、春夏秋冬。春夏秋冬、春夏秋冬。',4);
  assert.equal(m.evaluate('XYZ').loss,null);
  assert.equal(m.evaluate('XYZ').coverage,0);
  assert.ok(m.evaluate('春夏秋冬').loss!==null);
});
test('model restore validates all finite weights and shape',()=>{
  const m=new ScratchBigram();m.train('ABCDEABCDEABCDEABCDE',5);
  const snapshot=m.snapshot();const r=new ScratchBigram();
  assert.equal(r.restore(snapshot),true);
  assert.equal(r.generate('A',40),m.generate('A',40));
  assert.equal(new ScratchBigram().restore({...snapshot,weights:[Infinity]}),false);
  assert.equal(new ScratchBigram().restore({...snapshot,vocab:['Z','Z']}),false);
});
test('weight-space edit and rollback without pretrained parameters',()=>{
  const m=new ScratchBigram();m.train('ABABABABABAB',2);
  const p=m.edit('A','B',6);assert.equal(p.after,6);
  assert.equal(m.rollback(),true);assert.equal(m.weights[m.index().get('A')*m.size+m.index().get('B')],p.before);
  assert.throws(()=>m.edit('A','Z',5));assert.throws(()=>m.edit('A','B',Infinity));
  assert.equal(m.rollback(),false);
});
test('incremental vocabulary expansion preserves model probability weights',()=>{
  const m=new ScratchBigram();m.train('ABABABABAB',2);
  const prev=m.weights[m.index().get('A')*m.size+m.index().get('B')];
  m.train('ACACACACAC',2);const a=m.index().get('A'),b=m.index().get('B');
  assert.ok(Number.isFinite(m.weights[a*m.size+b]));
  assert.ok(m.size===3 && m.weights[a*m.size+b]!==prev);
});
test('model vocab bound does not erase previously saved weights on failure',()=>{
  const m=new ScratchBigram();m.train('ABABABAB',1);
  const before=m.snapshot();
  assert.throws(()=>m.train(Array.from({length:100},(_,i)=>String.fromCharCode(i+1000)).join(''),1));
  assert.deepEqual(m.snapshot(),before);
});
test('document retrieval reports exact citation and abstains for missing text',()=>{
  const docs=[{title:'lab.md',text:'実験番号A01\n温度センサーの閾値は25度です\nバッテリー残量は30%'}];
  assert.equal(retrieveEvidence('温度センサーの閾値',docs)[0].line,2);
  assert.deepEqual(retrieveEvidence('ふかふか猫',docs),[]);
  const e=new SolZeroEngine();
  assert.match(e.reply('/ask 温度センサーの閾値',{}, {documents:docs}),/lab.md 2行目/);
  assert.match(e.reply('/ask ふかふか猫',{}, {documents:docs}),/推測では回答しません/);
});
test('chat /generate calls the scratch predictor only when trained',()=>{
  const e=new SolZeroEngine(),m=new ScratchBigram();
  assert.match(e.reply('/generate A',{}, {generator:m}),/まだ学習していません/);
  m.train('ABABABABABABABAB',2);
  assert.match(e.reply('/model',{}, {generator:m}),/重み/);
  assert.match(e.reply('/generate A',{}, {generator:m}),/実験的な文字予測/);
});
