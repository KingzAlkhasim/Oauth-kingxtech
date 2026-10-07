import { supabaseAdmin } from '../lib/supabaseAdmin';
import { deflateSync } from 'node:zlib';
import { assertProjectOwnership, hasPublishedBuild, readPublishedBuildFile, readProjectFilePublic } from './projectFs';

export interface ProjectPwaConfig {
  name: string;
  slug: string | null;
  enabled: boolean;
  themeColor: string;
  backgroundColor: string;
}

const DEFAULT_THEME = '#ffffff';

export async function getProjectPwaConfig(projectId: string): Promise<ProjectPwaConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('name, slug, pwa_enabled, pwa_theme_color, pwa_background_color')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error('getProjectPwaConfig failed: ' + error.message);
  if (!data) return null;
  return {
    name: data.name || 'KingxTech Project',
    slug: data.slug ?? null,
    enabled: data.pwa_enabled === true,
    themeColor: data.pwa_theme_color || DEFAULT_THEME,
    backgroundColor: data.pwa_background_color || DEFAULT_THEME,
  };
}

export async function setProjectPwaEnabled(userId: string, projectId: string, enabled: boolean): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const { error } = await supabaseAdmin.from('projects').update({ pwa_enabled: enabled }).eq('id', projectId);
  if (error) throw new Error('setProjectPwaEnabled failed: ' + error.message);
}

function extractMetaColor(html: string, name: string): string | null {
  const re = new RegExp('<meta\\s+[^>]*name=["\\\']' + name + '["\\\'][^>]*content=["\\\'](#[0-9a-fA-F]{3,8})["\\\'][^>]*>', 'i');
  return html.match(re)?.[1] ?? null;
}

export async function getProjectPwaColors(projectId: string, fallback: ProjectPwaConfig): Promise<{ themeColor: string; backgroundColor: string }> {
  let html = '';
  if (await hasPublishedBuild(projectId)) {
    const file = await readPublishedBuildFile(projectId, 'index.html');
    html = file?.content ?? '';
  } else {
    const file = await readProjectFilePublic(projectId, 'index.html');
    html = file?.content ?? '';
  }

  return {
    themeColor: extractMetaColor(html, 'theme-color') ?? fallback.themeColor,
    backgroundColor: extractMetaColor(html, 'pwa-background-color') ?? fallback.backgroundColor,
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBytes, Buffer.from(data), crc]);
}

export function buildPwaIconPng(size: 192 | 512): Buffer {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const center = size / 2;
  const outerRadius = size * 0.42;
  const innerRadius = size * 0.34;
  const bar = size * 0.12;
  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    rgba[offset] = r; rgba[offset + 1] = g; rgba[offset + 2] = b; rgba[offset + 3] = 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const outer = dx * dx + dy * dy <= outerRadius * outerRadius;
      const inner = dx * dx + dy * dy <= innerRadius * innerRadius;
      if (outer) setPixel(x, y, 99, 102, 241);
      if (inner) setPixel(x, y, 24, 24, 27);
    }
  }

  const inK = (x: number, y: number) => {
    const left = size * 0.32;
    const right = size * 0.68;
    const top = size * 0.23;
    const bottom = size * 0.77;
    const mid = size * 0.5;
    if (x >= left && x <= left + bar && y >= top && y <= bottom) return true;
    if (x >= left + bar * 0.85 && x <= right && Math.abs((x - mid) * 0.9 - (y - mid)) <= bar * 0.65) return true;
    if (x >= left + bar * 0.85 && x <= right && Math.abs((x - mid) * 0.9 + (y - mid)) <= bar * 0.65) return true;
    return false;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inK(x, y)) setPixel(x, y, 255, 255, 255);
    }
  }

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function buildPwaManifest(config: ProjectPwaConfig, colors?: { themeColor: string; backgroundColor: string }): string {
  const name = config.name.trim() || 'KingxTech Project';
  return JSON.stringify({
    id: './', name, short_name: name.slice(0, 20),
    description: name + ' — published with KingxTech.',
    start_url: './', scope: './', display: 'standalone',
    theme_color: colors?.themeColor ?? config.themeColor, background_color: colors?.backgroundColor ?? config.backgroundColor,
    icons: [
      { src: './pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: './pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  }, null, 2);
}

export function buildPwaServiceWorker(projectId: string): string {
  const cacheName = 'kx-pwa-' + projectId + '-v1';
  return [
    'const CACHE_NAME = ' + JSON.stringify(cacheName) + ';',
    '',
    "self.addEventListener('install', (event) => {",
    "  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(new Request('./', { cache: 'reload' })).catch(() => undefined));",
    '  self.skipWaiting();',
    '});',
    '',
    "self.addEventListener('activate', (event) => {",
    '  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(\'kx-pwa-\') && key !== CACHE_NAME).map((key) => caches.delete(key)))));',
    '  self.clients.claim();',
    '});',
    '',
    "self.addEventListener('fetch', (event) => {",
    '  const request = event.request;',
    "  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;",
    "  const url = new URL(request.url);",
    "  if (url.pathname.endsWith('/kx-env.js') || url.pathname.includes('/api/')) return;",
    '  event.respondWith(fetch(request).then((response) => {',
    "    if (response.ok && (request.mode === 'navigate' || response.type === 'basic')) {",
    '      const copy = response.clone();',
    '      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);',
    '    }',
    '    return response;',
    "  }).catch(() => caches.match(request).then((cached) => cached || caches.match('./'))));",
    '});',
  ].join('\n');
}
