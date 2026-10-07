import { supabaseAdmin } from '../lib/supabaseAdmin';
import { deflateSync } from 'node:zlib';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { assertProjectOwnership, getProjectOwnerId, hasPublishedBuild, readPublishedBuildFile, readProjectFilePublic } from './projectFs';
import { getUserPlan } from './credits';

export interface ProjectPwaConfig {
  name: string;
  slug: string | null;
  enabled: boolean;
  themeColor: string;
  backgroundColor: string;
  pwaIconPath: string | null;
}

export const PWA_ICON_BUCKET = 'project-pwa-icons';

export class PwaIconError extends Error {
  constructor(public readonly status: 400 | 403 | 415, message: string) {
    super(message);
    this.name = 'PwaIconError';
  }
}
const MAX_PWA_ICON_BYTES = 1024 * 1024;
const MIN_PWA_ICON_SIZE = 512;
const MAX_PWA_ICON_SIZE = 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const DEFAULT_THEME = '#ffffff';

export async function getProjectPwaConfig(projectId: string): Promise<ProjectPwaConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('name, slug, pwa_enabled, pwa_theme_color, pwa_background_color, pwa_icon_path')
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
    pwaIconPath: data.pwa_icon_path ?? null,
  };
}

export async function getProjectPwaIconPublicUrl(
  projectId: string,
  config?: ProjectPwaConfig | null,
  ownerId?: string | null,
  plan?: 'free' | 'paid',
): Promise<string | null> {
  const resolvedConfig = config === undefined ? await getProjectPwaConfig(projectId) : config;
  if (!resolvedConfig?.pwaIconPath) return null;
  const resolvedOwnerId = ownerId === undefined ? await getProjectOwnerId(projectId) : ownerId;
  const resolvedPlan = plan === undefined && resolvedOwnerId ? await getUserPlan(resolvedOwnerId) : plan;
  if (!resolvedOwnerId || resolvedPlan !== 'paid') return null;
  return supabaseAdmin.storage.from(PWA_ICON_BUCKET).getPublicUrl(resolvedConfig.pwaIconPath).data.publicUrl;
}

export async function validatePwaIcon(buffer: Buffer): Promise<{ width: number; height: number }> {
  if (buffer.length > MAX_PWA_ICON_BYTES) {
    throw new PwaIconError(400, 'Icon must be 1 MB or smaller.');
  }
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new PwaIconError(400, 'Icon must be a PNG image. SVG and all other file types are not supported.');
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_PWA_ICON_SIZE * MAX_PWA_ICON_SIZE }).metadata();
  } catch {
    throw new PwaIconError(400, 'The uploaded file is not a valid PNG image.');
  }
  if (metadata.format !== 'png') throw new PwaIconError(400, 'Icon must be a PNG image. SVG and all other file types are not supported.');
  if (!metadata.width || !metadata.height) throw new PwaIconError(400, 'Could not read the PNG dimensions.');
  if (metadata.width !== metadata.height) throw new PwaIconError(400, 'Icon must be square (the same width and height).');
  if (metadata.width < MIN_PWA_ICON_SIZE || metadata.height < MIN_PWA_ICON_SIZE) {
    throw new PwaIconError(400, 'Icon must be at least 512×512 pixels.');
  }
  if (metadata.width > MAX_PWA_ICON_SIZE || metadata.height > MAX_PWA_ICON_SIZE) {
    throw new PwaIconError(400, 'Icon must be no larger than 1024×1024 pixels.');
  }
  return { width: metadata.width, height: metadata.height };
}

export async function uploadProjectPwaIcon(userId: string, projectId: string, buffer: Buffer): Promise<{ publicUrl: string }> {
  await assertProjectOwnership(userId, projectId);
  if (await getUserPlan(userId) !== 'paid') throw new PwaIconError(403, 'Custom PWA icons require the Pro plan.');
  await validatePwaIcon(buffer);

  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects').select('pwa_icon_path').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (projectError) throw new Error('Failed to load current PWA icon: ' + projectError.message);
  if (!project) throw new Error('You do not own this project.');

  const path = userId + '/' + projectId + '/' + crypto.randomUUID() + '.png';
  const { error: uploadError } = await supabaseAdmin.storage.from(PWA_ICON_BUCKET).upload(path, buffer, {
    contentType: 'image/png', cacheControl: '300', upsert: false,
  });
  if (uploadError) throw new Error('Failed to upload icon: ' + uploadError.message);

  const { error: updateError } = await supabaseAdmin
    .from('projects').update({ pwa_icon_path: path }).eq('id', projectId).eq('user_id', userId);
  if (updateError) {
    await supabaseAdmin.storage.from(PWA_ICON_BUCKET).remove([path]).catch(() => undefined);
    throw new Error('Failed to save icon: ' + updateError.message);
  }

  if (project.pwa_icon_path) {
    await supabaseAdmin.storage.from(PWA_ICON_BUCKET).remove([project.pwa_icon_path]).catch((error) => {
      console.error('Failed to remove replaced PWA icon:', (error as Error)?.message || error);
    });
  }
  return { publicUrl: supabaseAdmin.storage.from(PWA_ICON_BUCKET).getPublicUrl(path).data.publicUrl };
}

export async function removeProjectPwaIcon(userId: string, projectId: string): Promise<void> {
  await assertProjectOwnership(userId, projectId);
  const { data: project, error } = await supabaseAdmin
    .from('projects').select('pwa_icon_path').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Failed to load current PWA icon: ' + error.message);
  if (!project) throw new Error('You do not own this project.');
  if (!project.pwa_icon_path) return;
  const { error: updateError } = await supabaseAdmin.from('projects')
    .update({ pwa_icon_path: null }).eq('id', projectId).eq('user_id', userId);
  if (updateError) throw new Error('Failed to remove icon: ' + updateError.message);
  const { error: deleteError } = await supabaseAdmin.storage.from(PWA_ICON_BUCKET).remove([project.pwa_icon_path]);
  if (deleteError) console.error('Failed to delete removed PWA icon:', deleteError.message);
}

export async function getProjectPwaIconPng(projectId: string, size: 192 | 512): Promise<Buffer> {
  const config = await getProjectPwaConfig(projectId);
  if (!config?.pwaIconPath) return buildPwaIconPng(size);
  const ownerId = await getProjectOwnerId(projectId);
  if (!ownerId || await getUserPlan(ownerId) !== 'paid') return buildPwaIconPng(size);

  const { data, error } = await supabaseAdmin.storage.from(PWA_ICON_BUCKET).download(config.pwaIconPath);
  if (error || !data) return buildPwaIconPng(size);
  try {
    const source = Buffer.from(await data.arrayBuffer());
    await validatePwaIcon(source);
    return await sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer();
  } catch (error) {
    console.error('Failed to render custom PWA icon, using default:', error);
    return buildPwaIconPng(size);
  }
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
