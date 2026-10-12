export interface UsageWindow{start:Date;spentUsd:number}
export function advanceWindow(window:UsageWindow|null,now:Date,durationMs:number,costUsd:number):UsageWindow{
 const expired=!window||window.start.getTime()+durationMs<=now.getTime();
 return {start:expired?new Date(now):new Date(window!.start),spentUsd:(expired?0:window!.spentUsd)+Math.max(0,costUsd)};
}
export function clampPercent(spent:number,budget:number):number{return budget<=0?100:Math.max(0,Math.min(100,Math.round(spent/budget*100)))}
