// Turns raw publish failures into a short message people can act on, plus the original
// text as "details" for anyone who wants it. Pure, so it is easy to test.
const MAX_DETAILS = 600;

export function friendlyPublishError({ message = '', status = 0, network = false } = {}) {
  const raw = String(message || '').trim();
  const details = raw.length > MAX_DETAILS ? `${raw.slice(0, MAX_DETAILS)}…` : raw;
  const out = (title, hint, showDetails = false) => ({ title, hint, details: showDetails ? details : '' });

  if (network || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return out('Could not reach KingxTech.', 'Check your internet connection and try again. Your project is saved.');
  }
  if (status === 401) return out('Your session expired.', 'Sign in again, then publish.');
  if (status === 403 && /suspend/i.test(raw)) return out('Publishing is turned off for this account.', 'Open Help to contact support.');
  if (status === 403) return out('You do not have permission to publish this project.', 'Only owners and editors can publish.');
  if (status === 429) return out('Too many tries in a short time.', 'Wait a minute and try again.');
  if (status === 502 || status === 503 || status === 504 || /timed? ?out|timeout|FUNCTION_INVOCATION_TIMEOUT/i.test(raw)) {
    return out('Publishing took too long.', 'The first publish of a project with many packages can take a few minutes. Try again, it is usually faster the second time.');
  }
  if (/requires an index\.html/i.test(raw)) {
    return out('Your project has no index.html.', 'Add an index.html file in the project root (not inside a folder), then publish again.');
  }
  if (/supports vite projects/i.test(raw)) {
    return out('This kind of project cannot be published yet.', 'Permanent publishing supports Vite and plain HTML projects. You can still use Preview.');
  }
  if (/dependency install failed/i.test(raw)) {
    return out('Installing your packages failed.', 'Check package.json for a wrong package name or version, then try again.', true);
  }
  if (/build failed|vite build|rollup|error during build/i.test(raw)) {
    return out('Your project failed to build.', 'Fix the error below (or ask K-XpertAI to fix it), then publish again.', true);
  }
  return out('Publishing did not finish.', 'Try again. If it keeps failing, ask K-XpertAI to check the project or contact support from Help.', true);
}
