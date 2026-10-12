export type UsageTier='free'|'pro'|'pro_plus';
export type MinimumTier='free'|'pro'|'pro_plus';
const rank:Record<UsageTier,number>={free:0,pro:1,pro_plus:2};
export function modelTierAllowed(tier:UsageTier,minimum:MinimumTier):boolean{return rank[tier]>=rank[minimum]}
export function shouldEnforcePaidUsage(mode:'shadow'|'enforce',tier:UsageTier):boolean{return mode==='enforce'&&tier!=='free'}
export function usageLimitResponse(window:'session'|'week',percent:number,resetsAt:string){return {code:'usage_limit' as const,window,usagePercent:Math.max(0,Math.min(100,percent)),resetsAt,message:`You've reached your usage limit for now. It resets at ${resetsAt}.`}}
