// Pure helpers for the documentation pages. Pages are Markdown files in src/docs/.
// File names set the order ("01-getting-started.md"); files starting with "_" are notes for the
// author and are never shown. A line like {{video: https://youtu.be/VIDEO_ID}} embeds a YouTube video.

const stripPrefix = (name) => name.replace(/^\d+-/, '').replace(/\.md$/i, '');

/** Builds the page list from { 'path/01-name.md': 'raw markdown' }. */
export function buildDocPages(rawByPath) {
  return Object.entries(rawByPath)
    .map(([path, raw]) => ({ file: path.split('/').pop(), raw: String(raw || '') }))
    .filter(({ file }) => !file.startsWith('_') && /\.md$/i.test(file))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(({ file, raw }) => {
      const lines = raw.replace(/\r\n/g, '\n').split('\n');
      const titleLine = lines.find((l) => /^#\s+/.test(l));
      const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : stripPrefix(file);
      const summaryLine = lines.find((l) => /^>\s+/.test(l));
      const summary = summaryLine ? summaryLine.replace(/^>\s+/, '').trim() : '';
      const body = lines.filter((l) => l !== titleLine && l !== summaryLine).join('\n').trim();
      return { slug: stripPrefix(file), title, summary, body };
    });
}

/** Extracts the 11-character video id from common YouTube links, or null. */
export function parseYouTubeId(url) {
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
        if (m) id = m[2];
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Splits a page body into [{ type: 'markdown', text } | { type: 'video', id }] blocks. */
export function splitVideoBlocks(body) {
  const blocks = [];
  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ type: 'markdown', text });
    buffer = [];
  };
  for (const line of String(body).split('\n')) {
    const match = line.trim().match(/^\{\{video:\s*(\S+?)\s*\}\}$/i);
    if (match) {
      const id = parseYouTubeId(match[1]);
      if (id) { flush(); blocks.push({ type: 'video', id }); }
      // An invalid or placeholder link is skipped instead of showing broken text.
    } else buffer.push(line);
  }
  flush();
  return blocks;
}

/** Simple ranked search over titles, summaries and text. Every word must appear somewhere. */
export function searchDocs(pages, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  return pages
    .map((page) => {
      const title = page.title.toLowerCase();
      const summary = page.summary.toLowerCase();
      const plain = page.body.replace(/^\s*\{\{video:.*\}\}\s*$/gim, '');
      const body = plain.toLowerCase();
      let score = 0;
      for (const w of words) {
        const inTitle = title.includes(w);
        const inSummary = summary.includes(w);
        const inBody = body.includes(w);
        if (!inTitle && !inSummary && !inBody) return null;
        score += (inTitle ? 10 : 0) + (inSummary ? 4 : 0) + (inBody ? 1 : 0);
      }
      const first = words.find((w) => body.includes(w));
      let snippet = page.summary;
      if (first) {
        const at = body.indexOf(first);
        const start = Math.max(0, at - 60);
        snippet = `${start > 0 ? '…' : ''}${plain.slice(start, at + 110).replace(/[#>*`{}]/g, '').replace(/\s+/g, ' ').trim()}…`;
      }
      return { page, score, snippet };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}
