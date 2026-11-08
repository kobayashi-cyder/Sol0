/* Tiny scratch-trained character-to-character softmax predictor.
   It is not a general conversation model. No third-party or pretrained weights. */
export class ScratchBigram {
  constructor(){this.vocab=[];this.weights=[];this.steps=0;this.events=[];this.version=1;}
  index(){return new Map(this.vocab.map((x,i)=>[x,i]));}
  get size(){return this.vocab.length;}
  expand(text){
    const unique=[...new Set([...text])];
    const newChars=unique.filter(ch=>!this.vocab.includes(ch));
    if(this.vocab.length+newChars.length>96)throw Error('使用文字が96種類を超えました。短い資料で試してください。');
    if(!newChars.length)return;
    const old=this.weights, n0=this.vocab.length, n=n0+newChars.length;
    const next=Array(n*n).fill(0);
    for(let i=0;i<n0;i++)for(let j=0;j<n0;j++)next[i*n+j]=old[i*n0+j];
    this.vocab.push(...newChars);this.weights=next;
  }
  // Uses stochastic gradient descent on the trainable bigram softmax matrix.
  train(text,epochs=8){
    const chars=[...String(text)];if(chars.length<8||chars.length>10000)throw Error('学習文章は8〜10,000文字にしてください。');
    if(!Number.isInteger(epochs)||epochs<1||epochs>20)throw Error('学習回数は1〜20です。');
    this.expand(text);
    const idx=this.index(), seq=chars.map(c=>idx.get(c)), n=this.size;
    const before=this.evaluate(text);
    for(let epoch=0;epoch<epochs;epoch++){
      const lr=.38 / (1+epoch*.18);
      for(let i=0;i<seq.length-1;i++){
        const row=seq[i]*n, target=seq[i+1];
        let max=-Infinity;for(let j=0;j<n;j++)max=Math.max(max,this.weights[row+j]);
        let denom=0;for(let j=0;j<n;j++)denom+=Math.exp(this.weights[row+j]-max);
        for(let j=0;j<n;j++){
          const p=Math.exp(this.weights[row+j]-max)/denom;
          this.weights[row+j]-=lr*(p-(j===target?1:0));
        }
      }
    }
    this.steps+=epochs*(seq.length-1);
    this.events=[]; // SGD makes prior direct-edit rollback history invalid
    return {before,after:this.evaluate(text),vocab:n,steps:this.steps};
  }
  evaluate(text){
    const chars=[...String(text)],idx=this.index(),n=this.size;
    if(chars.length<2||!n)return {loss:null,coverage:0,pairs:0,matched:0};
    let total=0,matched=0;
    for(let i=0;i<chars.length-1;i++){
      const a=idx.get(chars[i]), b=idx.get(chars[i+1]);
      if(a===undefined||b===undefined)continue;
      const row=a*n;let max=-Infinity;
      for(let j=0;j<n;j++)max=Math.max(max,this.weights[row+j]);
      let denom=0;for(let j=0;j<n;j++)denom+=Math.exp(this.weights[row+j]-max);
      total+=Math.log(denom)+max-this.weights[row+b];matched++;
    }
    return {loss:matched?Number((total/matched).toFixed(5)):null,
      coverage:matched/(chars.length-1),matched,pairs:chars.length-1};
  }
  generate(prompt='',length=100,seed=2026){
    if(!this.size||!this.steps)throw Error('先に文章を学習してください。');
    length=Math.min(240,Math.max(1,Math.floor(length)));
    let state=this.index().get([...prompt].at(-1));
    if(state===undefined)state=0;
    let out='',rng=(Number(seed)>>>0)||1,n=this.size;
    for(let k=0;k<length;k++){
      const row=state*n;let max=-Infinity;for(let j=0;j<n;j++)max=Math.max(max,this.weights[row+j]);
      const temp=.8;let sum=0;const probs=[];
      for(let j=0;j<n;j++){const p=Math.exp((this.weights[row+j]-max)/temp);probs.push(p);sum+=p;}
      rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;
      let r=((rng>>>0)/4294967296)*sum,next=0;
      for(let j=0;j<n;j++){r-=probs[j];if(r<=0){next=j;break;}}
      out+=this.vocab[next];state=next;
    }
    return out;
  }
  edit(from,to,value){
    const idx=this.index(),i=idx.get(from),j=idx.get(to);
    if(i===undefined||j===undefined||!Number.isFinite(value)||Math.abs(value)>30)throw Error('文字または重みが範囲外です。');
    const k=i*this.size+j,before=this.weights[k];this.weights[k]=value;
    const patch={from,to,before,after:value};this.events.push(patch);
    if(this.events.length>50)this.events.shift();return patch;
  }
  rollback(){
    const p=this.events.pop();if(!p)return false;
    const idx=this.index(),k=idx.get(p.from)*this.size+idx.get(p.to);
    if(this.weights[k]!==p.after){this.events=[];return false;}
    this.weights[k]=p.before;return true;
  }
  snapshot(){return {version:1,vocab:[...this.vocab],weights:[...this.weights],steps:this.steps,events:this.events.map(p=>({...p}))};}
  restore(snapshot){
    if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.vocab)||
       snapshot.vocab.length>96||new Set(snapshot.vocab).size!==snapshot.vocab.length||
       !snapshot.vocab.every(c=>typeof c==='string'&&[...c].length===1)||
       !Array.isArray(snapshot.weights)||snapshot.weights.length!==snapshot.vocab.length**2||
       !snapshot.weights.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=30)||
       !Number.isSafeInteger(snapshot.steps)||snapshot.steps<0||snapshot.steps>10000000)return false;
    this.vocab=[...snapshot.vocab];this.weights=[...snapshot.weights];this.steps=snapshot.steps;this.events=[];
    return true;
  }
}
