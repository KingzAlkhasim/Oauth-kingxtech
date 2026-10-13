export type ModelRoutingTier = 'free' | 'pro' | 'pro_plus';

export interface RoutableModel {
  code: string;
}

/** Resolves Auto to Qwen for Free and Gemma for paid plans. */
export function resolveDefaultModelForTier<T extends RoutableModel>(tier: ModelRoutingTier, models: readonly T[]): T {
  const code = tier === 'free' ? 'qwen' : 'gemma';
  const model = models.find((candidate) => candidate.code === code);
  if (!model) throw new Error('Default model ' + code + ' is missing from the registry.');
  return model;
}
