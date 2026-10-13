export function shouldFallbackToFreeModel(provider: string, gemmaFailed: boolean): boolean {
  return provider === 'gemma-google' && gemmaFailed;
}

/** Google provider internals and request URLs are never suitable for client-facing errors. */
export function sanitizeGemmaError(_error: unknown): string {
  return 'Gemma is temporarily unavailable. Please try again shortly.';
}

export function isTransientGemmaError(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: number; message?: string; response?: { status?: number } } | null;
  const status = value?.status ?? value?.statusCode ?? value?.response?.status;
  if (status === 500 || status === 503) return true;
  return /(?:\b500\b|\b503\b|internal server error|service unavailable)/i.test(value?.message ?? '');
}
