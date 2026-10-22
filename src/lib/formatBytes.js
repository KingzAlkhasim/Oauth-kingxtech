// Human-friendly sizes: 0 B, 512 B, 1.5 KB, 3.2 MB, 1.1 GB.
export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  const shown = i === 0 ? String(Math.round(n)) : (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '');
  return `${shown} ${units[i]}`;
}
