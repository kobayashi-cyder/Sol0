/**
 * Local-only prompt assist for a user-supplied ComfyUI checkpoint.
 * This is a deterministic vocabulary mapper, not an image language model.
 */
import {planImageScene} from './scene_director.js';

const KIND=Object.freeze({
 cat:'cat',dog:'dog',robot:'robot',boat:'sailboat',house:'house',
 bird:'bird',person:'person',car:'car',tree:'tree',flower:'flower',
 cloud:'cloud',moon:'moon',sun:'sun'
});
const COLOR=Object.freeze({
 '#d95255':'red','#488bc1':'blue','#e1b94e':'golden yellow',
 '#6ca48a':'green','#a788ce':'purple','#ef9cc8':'pink',
 '#e6e7ec':'white','#343b52':'black'
});
const POSITION=Object.freeze({left:'on the left',right:'on the right',
 center:'in the center',auto:''});
const DEPTH=Object.freeze({far:'in the background',near:'in the foreground',mid:''});
const LIGHT=Object.freeze({night:'natural night lighting',golden:'golden hour lighting',
 morning:'early morning light',day:'natural daylight'});
const THEME=Object.freeze({space:'star-filled space',sea:'sea and ocean waves',
 mountain:'mountain landscape',forest:'forest scenery',city:'cityscape',
 flowers:'flower garden',rain:'rainfall',snow:'snow-covered landscape',
 sunset:'sunset sky',abstract:'visually cohesive environment'});

function boundedImagePromptText(s,max=180){
 if(typeof s!=='string'||!s.trim())throw Error('画像生成の説明文を入力してください');
 if(s.length>max)throw Error('画像生成の説明文が長すぎます');
 return s.trim();
}

export function buildPhotorealPrompt(raw,{
 negativePrompt='blurry, watermark, signature, low resolution',
 maxCharacters=1600
}={}){
 const prompt=boundedImagePromptText(raw?.prompt);
 const seed=Number(raw?.seed);
 const width=Number(raw?.width),height=Number(raw?.height);
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff||
    !Number.isInteger(width)||width<96||width>1024||
    !Number.isInteger(height)||height<72||height>1024){
   throw Error('画像生成サイズまたはシードが範囲外です');
 }
 const theme=typeof raw.theme==='string'?raw.theme:'abstract';
 const plan=planImageScene(prompt,{seed,theme,width,height});
 if(typeof negativePrompt!=='string'||negativePrompt.length>500)throw Error('ネガティブ指定が長すぎます');
 const objects=plan.subjects.map(subject=>{
   return [COLOR[subject.color]??'',KIND[subject.kind]??subject.kind,
     POSITION[subject.position]??'',DEPTH[subject.depth]??''].filter(Boolean).join(' ');
 });
 const derived=[
   'photorealistic photograph','natural materials and physically plausible lighting',
   'detailed textures','coherent perspective',THEME[theme]??THEME.abstract,
   LIGHT[plan.lighting],...objects
 ];
 // Preserve the user's original text; unknown entities must not disappear.
 const positive=derived.join(', ')+', '+prompt;
 if(positive.length>maxCharacters)throw Error('構図プロンプトが上限を超えました');
 return Object.freeze({
   positive,negative:negativePrompt.trim(),seed,width,height,
   subjects:plan.subjects.length,sceneStyle:plan.style,
   interpretation:'rule-based composition aid; no guarantee of image fidelity'
 });
}
