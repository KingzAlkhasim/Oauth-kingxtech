export interface TokenUsage{inputTokens:number;outputTokens:number;cachedInputTokens?:number}
export interface ModelPrice{inputUsdPerMTok:number;outputUsdPerMTok:number;cachedInputUsdPerMTok?:number;verified:boolean}
const HIGH_UNVERIFIED_PRICE={inputUsdPerMTok:25,outputUsdPerMTok:100,cachedInputUsdPerMTok:25,verified:false} as const;
export const MODEL_PRICING:Record<string,ModelPrice>={
 qwen:{inputUsdPerMTok:0,outputUsdPerMTok:0,cachedInputUsdPerMTok:0,verified:true},
 llama:{inputUsdPerMTok:0,outputUsdPerMTok:0,cachedInputUsdPerMTok:0,verified:true},
 nemotron:{inputUsdPerMTok:0,outputUsdPerMTok:0,cachedInputUsdPerMTok:0,verified:true},
 deepseek:{inputUsdPerMTok:0,outputUsdPerMTok:0,cachedInputUsdPerMTok:0,verified:true},
 gemma:{inputUsdPerMTok:0,outputUsdPerMTok:0,cachedInputUsdPerMTok:0,verified:true},
 flash:{...HIGH_UNVERIFIED_PRICE},flash37:{...HIGH_UNVERIFIED_PRICE},flashlite:{...HIGH_UNVERIFIED_PRICE},
 // Official Google price confirmed for gemini-3.1-pro-preview; use highest published standard context rate.
 pro:{inputUsdPerMTok:4,outputUsdPerMTok:18,cachedInputUsdPerMTok:0.4,verified:true},
 sonnet:{...HIGH_UNVERIFIED_PRICE},opus:{...HIGH_UNVERIFIED_PRICE},haiku:{...HIGH_UNVERIFIED_PRICE},fable:{...HIGH_UNVERIFIED_PRICE},
 sonnet5:{...HIGH_UNVERIFIED_PRICE},opus5:{...HIGH_UNVERIFIED_PRICE},sol:{...HIGH_UNVERIFIED_PRICE},terra:{...HIGH_UNVERIFIED_PRICE},luna:{...HIGH_UNVERIFIED_PRICE},
 gpt6sol:{...HIGH_UNVERIFIED_PRICE},gpt6luna:{...HIGH_UNVERIFIED_PRICE},gpt55:{...HIGH_UNVERIFIED_PRICE},gpt54:{...HIGH_UNVERIFIED_PRICE},gpt54mini:{...HIGH_UNVERIFIED_PRICE},gpt53codex:{...HIGH_UNVERIFIED_PRICE},
};
export function computeCostUsd(modelCode:string,usage:TokenUsage):number{
 const p=MODEL_PRICING[modelCode]??HIGH_UNVERIFIED_PRICE;
 const input=Math.max(0,usage.inputTokens||0),output=Math.max(0,usage.outputTokens||0),cached=Math.min(input,Math.max(0,usage.cachedInputTokens||0));
 const value=((input-cached)*p.inputUsdPerMTok+cached*(p.cachedInputUsdPerMTok??p.inputUsdPerMTok)+output*p.outputUsdPerMTok)/1_000_000;
 return Math.round(value*1_000_000)/1_000_000;
}
