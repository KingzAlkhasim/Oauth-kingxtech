// One place that turns raw failures (network errors, database errors, gateway pages)
// into a short sentence people can act on. Readable messages pass through unchanged.
const GENERIC = 'Something went wrong. Please try again.';

function textOf(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.message || err.error_description || err.error || '');
}

export function friendlyError(err, fallback) {
  const raw = textOf(err).trim();
  const name = err && typeof err === 'object' ? String(err.name || '') : '';
  const code = err && typeof err === 'object' ? String(err.code || '') : '';
  const status = err && typeof err === 'object' ? Number(err.status || 0) : 0;

  if (/AuthRetryableFetchError/i.test(name) || /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_internet/i.test(raw)) {
    return 'Could not reach KingxTech. Check your internet connection and try again.';
  }
  if (name === 'AbortError' || /aborted|timed? ?out|timeout/i.test(raw)) {
    return 'This is taking too long. Check your connection and try again.';
  }
  if (/unexpected token|not valid json|unexpected end of json|unexpected character/i.test(raw)) {
    return 'KingxTech sent an unexpected reply. Please try again in a moment.';
  }
  if (/jwt expired|invalid jwt|refresh token|auth session missing|session (has )?expired|not authenticated/i.test(raw) || status === 401) {
    return 'Your session expired. Please sign in again.';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(raw) || status === 403) {
    return 'You do not have permission to do that.';
  }
  if (code === '23505' || /duplicate key value/i.test(raw)) {
    return 'That name or value is already taken. Try a different one.';
  }
  if (/(relation|function) .* does not exist|could not find the (table|function)/i.test(raw)) {
    return 'This feature is not fully set up yet. Please contact support from Help.';
  }
  if (status === 429 || /rate limit|too many requests/i.test(raw)) {
    return 'Too many tries in a short time. Wait a minute and try again.';
  }
  if (!raw || /^\[object \w+\]$/i.test(raw) || /^[{[].*[}\]]$/s.test(raw)) return fallback || GENERIC;
  if (raw.length > 300 || /\bat .+\(.+:\d+:\d+\)/.test(raw)) return fallback || GENERIC;
  return raw;
}
