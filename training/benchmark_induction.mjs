/** Fixed-seed independent input-combination benchmark. Held-out values are outside the training range.
 * This benchmark is a small, synthetic functional generalization check, not an AGI or language test.
 */
import fs from 'node:fs';
import {induceAndVerify} from '../chat_web/wsp_induction.js';
function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};}
function examples(random,count,min,max,seen,fn){
  const arr=[];
  while(arr.length<count){const x=Math.floor(random()*(max-min+1))+min,y=Math.floor(random()*(max-min+1))+min;
    const key=JSON.stringify([x,y]);if(seen.has(key))continue;seen.add(key);arr.push({input:[x,y],output:fn(x,y)});
  }
  return arr;
}
const tasks=[];
for(const family of ['affine','product','absdiff','max','min'])for(let seed=1;seed<=20;seed++){
  const random=rng(0x5A6B000+seed*131+family.length*777),seen=new Set();
  const a=1+Math.floor(random()*5),b=1+Math.floor(random()*5),c=Math.floor(random()*7)-3;
  const fn=family==='affine'?(x,y)=>a*x+b*y+c:family==='product'?(x,y)=>x*y:family==='absdiff'?(x,y)=>Math.abs(x-y):family==='max'?(x,y)=>Math.max(x,y):(x,y)=>Math.min(x,y);
  const train=examples(random,14,-9,9,seen,fn);
  const holdout=examples(random,8,10,30,seen,fn);
  const r=induceAndVerify({inputs:['x','y'],train,holdout});
  tasks.push({family,seed,passed:r.accepted,reason:r.status,correct:r.validation.correct,total:holdout.length,chosen:r.chosen});
}
const passed=tasks.filter(x=>x.passed).length;
const report={benchmark:'synthetic two-input numeric rule inference with unseen, out-of-range inputs',seeded:true,selection:'train only',holdout:'values 10..30; training values -9..9',taskCount:tasks.length,passed,rejected:tasks.length-passed,holdoutAccuracy:tasks.reduce((s,x)=>s+x.correct,0)/tasks.reduce((s,x)=>s+x.total,0),families:Object.fromEntries([...new Set(tasks.map(x=>x.family))].map(k=>[k,{passed:tasks.filter(x=>x.family===k&&x.passed).length,total:tasks.filter(x=>x.family===k).length}])),failed:tasks.filter(x=>!x.passed)};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--write'))fs.writeFileSync(new URL('../artifacts/induction_benchmark_v011.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
