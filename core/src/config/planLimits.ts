export type PaidTier='pro'|'pro_plus';
export const PLAN_LIMITS:Record<PaidTier,{sessionHours:number;sessionBudgetUsd:number;weekDays:number;weekBudgetUsd:number;maxRunCostUsd:number}> = {
 // Tune from real ledger data after 1–2 weeks of traffic.
 pro:{sessionHours:5,sessionBudgetUsd:0.90,weekDays:7,weekBudgetUsd:2.25,maxRunCostUsd:0.60},
 pro_plus:{sessionHours:5,sessionBudgetUsd:4.50,weekDays:7,weekBudgetUsd:11.25,maxRunCostUsd:2.50},
};
export const FREE_MONTHLY_ALLOWANCE=300;
