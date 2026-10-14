import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCostUsd } from '../src/config/modelPricing';
import { resolveDefaultModelForTier } from '../src/services/modelDefaults';
import { sanitizeGemmaError, shouldFallbackToFreeModel, isTransientGemmaError } from '../src/services/gemmaFallback';
import { advanceWindow, clampPercent } from '../src/config/usageWindows';
import { modelTierAllowed, shouldEnforcePaidUsage, usageLimitResponse, usageBudgetReached } from '../src/services/usagePolicy';
import { canInvite, canWriteProject, canManageProject, canDeleteProject, memberCapForTier, canAddMember, maskEmail, nextTransferStatus } from '../src/config/collaboration';
const assertClose = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be within 1e-9 of ${expected}`);
test('computeCostUsd applies per-million input/output and cached pricing',()=>{
 assertClose(computeCostUsd('pro',{inputTokens:1_000_000,outputTokens:1_000_000}),22);
 assertClose(computeCostUsd('pro',{inputTokens:1_000_000,outputTokens:0,cachedInputTokens:500_000}),2.2);
 assert.equal(computeCostUsd('qwen',{inputTokens:100_000,outputTokens:100_000}),0);
 assertClose(computeCostUsd('sonnet',{inputTokens:1_000_000,outputTokens:1_000_000}),12);
 assertClose(computeCostUsd('haiku',{inputTokens:1_000_000,outputTokens:1_000_000}),6);
 assertClose(computeCostUsd('luna',{inputTokens:1_000_000,outputTokens:1_000_000}),1.4);
 assertClose(computeCostUsd('sonnet',{inputTokens:1_000_000,outputTokens:0,cacheCreationInputTokens:1_000_000}),2.5);
});
test('windows start, accrue, and reset after expiry',()=>{
 const now=new Date('2026-10-12T12:00:00Z'),first=advanceWindow(null,now,5*3600000,0.25);
 assert.equal(first.spentUsd,0.25);assert.equal(first.start.toISOString(),now.toISOString());
 assertClose(advanceWindow(first,new Date(now.getTime()+1000),5*3600000,0.1).spentUsd,0.35);
 assertClose(advanceWindow(first,new Date(now.getTime()+5*3600000),5*3600000,0.2).spentUsd,0.2);
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
test('Auto routing chooses Qwen for Free and Gemma for Pro and Pro+', () => {
 const registry = [{ code: 'qwen', minTier: 'free' }, { code: 'llama', minTier: 'free' }, { code: 'gemma', minTier: 'free' }];
 assert.equal(resolveDefaultModelForTier('free', registry).code, 'qwen');
 assert.equal(resolveDefaultModelForTier('pro', registry).code, 'gemma');
 assert.equal(resolveDefaultModelForTier('pro_plus', registry).code, 'gemma');
 assert.equal(resolveDefaultModelForTier('pro', registry).minTier, 'free');
});
test('Gemma fallback decision is limited to failed Gemma requests', () => {
 assert.equal(shouldFallbackToFreeModel('gemma-google', true), true);
 assert.equal(shouldFallbackToFreeModel('gemma-google', false), false);
 assert.equal(shouldFallbackToFreeModel('openweights', true), false);
 assert.equal(shouldFallbackToFreeModel('gemma-google', true, true), false);
});
test('Gemma errors are sanitized and transient 500/503 errors are retryable', () => {
 const safe = sanitizeGemmaError(new Error('GoogleGenerativeAIFetchError https://generativelanguage.googleapis.com/v1/models/gemma:generateContent 500 Internal Server Error'));
 assert.equal(safe, 'Gemma is temporarily unavailable. Please try again shortly.');
 assert.doesNotMatch(safe, /googleapis|generateContent|500 Internal Server Error/i);
 assert.equal(isTransientGemmaError({ status: 500 }), true);
 assert.equal(isTransientGemmaError({ statusCode: 503 }), true);
 assert.equal(isTransientGemmaError({ status: 400 }), false);
});

test('collaboration roles and plan caps are centralized', () => {
 assert.equal(canInvite('owner'), true); assert.equal(canInvite('editor'), true); assert.equal(canInvite('viewer'), false);
 assert.equal(canWriteProject('editor'), true); assert.equal(canWriteProject('viewer'), false);
 assert.equal(canManageProject('owner'), true); assert.equal(canManageProject('editor'), false);
 assert.equal(canDeleteProject('owner'), true); assert.equal(canDeleteProject('editor'), false);
 assert.equal(memberCapForTier('free'), 2); assert.equal(memberCapForTier('pro'), 10); assert.equal(memberCapForTier('pro_plus'), 10);
 assert.equal(canAddMember('free', 1, 0), true); assert.equal(canAddMember('free', 2, 0), true); assert.equal(canAddMember('free', 3, 0), false);
 assert.equal(canAddMember('pro', 11, 0), false); assert.equal(canAddMember('pro_plus', 10, 0), true);
 assert.equal(canAddMember('free', 2, 1), false);
});

test('invite validation helpers mask email and transfer state transitions', () => {
 assert.equal(maskEmail('person@example.com'), 'p****n@example.com');
 assert.equal(maskEmail('a@example.com'), 'a***@example.com');
 assert.equal(nextTransferStatus('pending','accept'), 'accepted');
 assert.equal(nextTransferStatus('pending','decline'), 'declined');
 assert.equal(nextTransferStatus('pending','cancel'), 'cancelled');
 assert.equal(nextTransferStatus('accepted','decline'), 'accepted');
});
