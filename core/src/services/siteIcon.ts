// A simple, distinct default icon for sites that have not uploaded their own:
// a coloured tile (colour comes from the site's name) with the site's first letter.
// Pure code with no fonts or image libraries, so it works anywhere.
import { deflateSync } from 'node:zlib';

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};
export const SUPPORTED_INITIALS = Object.keys(FONT);

export function siteInitial(name: string): string {
  const match = String(name ?? '').toUpperCase().match(/[A-Z0-9]/);
  return match ? match[0] : 'K';
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Same name, same colour, every time. Dark enough for the white letter to be readable. */
export function siteIconColor(name: string): [number, number, number] {
  return hslToRgb(hash(String(name ?? '').trim().toLowerCase()) % 360, 0.55, 0.38);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function buildInitialIconPng(size: number, name: string): Buffer {
  const [r, g, b] = siteIconColor(name);
  const glyph = FONT[siteInitial(name)];
  const cell = Math.floor((size * 0.56) / 7);           // letter is 7 cells tall, 5 wide
  const left = Math.floor((size - cell * 5) / 2);
  const top = Math.floor((size - cell * 7) / 2);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    const gy = Math.floor((y - top) / cell);
    for (let x = 0; x < size; x += 1) {
      const gx = Math.floor((x - left) / cell);
      const on = gy >= 0 && gy < 7 && gx >= 0 && gx < 5 && glyph[gy][gx] === '1';
      const o = row + 1 + x * 4;
      raw[o] = on ? 255 : r; raw[o + 1] = on ? 255 : g; raw[o + 2] = on ? 255 : b; raw[o + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** True when the page already declares its own icon (apple-touch-icon alone does not count). */
export function hasFaviconLink(html: string): boolean {
  for (const tag of String(html).match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? '').toLowerCase();
    if (value.split(/\s+/).some((token) => token === 'icon')) return true;
  }
  return false;
}
