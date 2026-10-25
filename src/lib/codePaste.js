// When someone pastes several lines of code into the chat box, wrap it in a code block
// so it keeps its shape and the AI (and the person) can read it.
const CODE_HINT = /(=>|\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bimport\b|\bexport\b|\breturn\b|\bclass\b|\bdef\b|<\/?[a-z][^>]*>|[{};]\s*$|^\s*[.#@]?[\w-]+\s*\{|^\s*(?:\/\/|#include|<\?php))/m;

export function looksLikeCode(text) {
  const value = String(text ?? '');
  if (value.includes('```')) return false;
  const lines = value.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return false;
  return CODE_HINT.test(value);
}

export function fencePastedCode(text) {
  return '```\n' + String(text).replace(/^\n+|\s+$/g, '') + '\n```\n';
}
