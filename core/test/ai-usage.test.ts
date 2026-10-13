import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostUsd } from '../src/config/modelPricing';
import { advanceWindow, clampPercent } from '../src/config/usageWindows';
import { modelTierAllowed, shouldEnforcePaidUsage, usageLimitResponse, usageBudgetReached } from '../src/services/usagePolicy';
test('computeCostUsd applies per-million input/output and cached pricing',()=>{
 assert.equal(computeCostUsd('pro',{inputTokens:1_000_000,outputTokens:1_000_000}),22);
 assert.equal(computeCostUsd('pro',{inputTokens:1_000_000,outputTokens:0,cachedInputTokens:500_000}),2.2);
 assert.equal(computeCostUsd('qwen',{inputTokens:100_000,outputTokens:100_000}),0);
 assert.equal(computeCostUsd('sonnet',{inputTokens:1_000_000,outputTokens:1_000_000}),12);
 assert.equal(computeCostUsd('haiku',{inputTokens:1_000_000,outputTokens:1_000_000}),6);
 assert.equal(computeCostUsd('luna',{inputTokens:1_000_000,outputTokens:1_000_000}),1.4);
 assert.equal(computeCostUsd('sonnet',{inputTokens:1_000_000,outputTokens:0,cacheCreationInputTokens:1_000_000}),2.5);
});
test('windows start, accrue, and reset after expiry',()=>{
 const now=new Date('2026-10-12T12:00:00Z'),first=advanceWindow(null,now,5*3600000,0.25);
 assert.equal(first.spentUsd,0.25);assert.equal(first.start.toISOString(),now.toISOString());
 assert.equal(advanceWindow(first,new Date(now.getTime()+1000),5*3600000,0.1).spentUsd,0.35);
 assert.equal(advanceWindow(first,new Date(now.getTime()+5*3600000),5*3600000,0.2).spentUsd,0.2);
 assert.equal(clampPercent(2,1),100);
});
test('simultaneous spend calls retain both updates under a serialized row-lock model',async()=>{
 const now=new Date('2026-10-12T12:00:00Z'),duration=5*3600000;
 const holder:{state:ReturnType<typeof advanceWindow>|null}={state:null};
 let lock=Promise.resolve();
 const record=(cost:number)=>{const next=lock.then(()=>{holder.state=advanceWindow(holder.state,now,duration,cost)});lock=next;return next};
 await Promise.all([record(0.1),record(0.2)]);
 assert.ok(Math.abs((holder.state?.spentUsd ?? 0)-0.3)<1e-9);
});
test('tier gate denies Pro on Pro+ model and preserves free tier restrictions',()=>{
 assert.equal(modelTierAllowed('pro','pro_plus'),false);assert.equal(modelTierAllowed('pro_plus','pro_plus'),true);assert.equal(modelTierAllowed('free','pro'),false);
});
test('shadow mode does not enable new paid usage enforcement',()=>{
 assert.equal(shouldEnforcePaidUsage('shadow','pro'),false);assert.equal(shouldEnforcePaidUsage('shadow','pro_plus'),false);assert.equal(shouldEnforcePaidUsage('enforce','pro'),true);
});
test('enforce mode rejects at 100% and includes reset timestamp',()=>{
 assert.equal(usageBudgetReached(0.9,0.9),true);assert.equal(usageBudgetReached(0.899,0.9),false);
 const reset='2026-10-12T17:00:00.000Z';assert.deepEqual(usageLimitResponse('session',120,reset),{code:'usage_limit',window:'session',usagePercent:100,resetsAt:reset,message:`You've reached your usage limit for now. It resets at ${reset}.`});
});
