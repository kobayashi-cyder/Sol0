import test from 'node:test';
import assert from 'node:assert/strict';
import {gifBytes,MEDIA_LIMITS} from '../chat_web/media_studio.js';

const frames=n=>Array.from({length:n},()=>new Uint8Array([0]));
test('GIF generator accepts exactly eight seconds',()=>{
 const encoded=gifBytes(frames(16),1,1,2);
 assert.equal(new TextDecoder().decode(encoded.slice(0,6)),'GIF89a');
});
test('GIF generator refuses more than eight seconds including direct API calls',()=>{
 assert.equal(MEDIA_LIMITS.duration,8);
 assert.throws(()=>gifBytes(frames(17),1,1,2),/GIF制限超過/);
 assert.throws(()=>gifBytes(frames(60),1,1,2),/GIF制限超過/);
});
