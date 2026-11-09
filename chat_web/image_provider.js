/**
 * Image provider registry. Default stays procedural and never accesses a URL.
 * Provider configuration belongs to the current UI action, not localStorage.
 */
import {createComfyUIProvider} from './image_provider_comfyui.js';

export function createImageProvider(config={type:'none'},deps={}){
 if(config?.type==='comfyui')return createComfyUIProvider(config,deps);
 if(config?.type===undefined||config?.type==='none')return Object.freeze({
   kind:'none',
   async available(){return false;},
   async generate(){throw Error('写実画像は未接続です。通常のPNG生成を使用できます。');}
 });
 throw Error('画像プロバイダ種別が不正です');
}
