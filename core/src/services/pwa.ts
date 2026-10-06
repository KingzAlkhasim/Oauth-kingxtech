import { supabaseAdmin } from '../lib/supabaseAdmin';
import { assertProjectOwnership, hasPublishedBuild, readPublishedBuildFile, readProjectFilePublic } from './projectFs';

export interface ProjectPwaConfig {
  name: string;
  slug: string | null;
  enabled: boolean;
  themeColor: string;
  backgroundColor: string;
}

const DEFAULT_THEME = '#09090B';

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

export function buildPwaManifest(config: ProjectPwaConfig, colors?: { themeColor: string; backgroundColor: string }): string {
  const name = config.name.trim() || 'KingxTech Project';
  return JSON.stringify({
    id: './', name, short_name: name.slice(0, 20),
    description: name + ' — published with KingxTech.',
    start_url: './', scope: './', display: 'standalone',
    theme_color: colors?.themeColor ?? config.themeColor, background_color: colors?.backgroundColor ?? config.backgroundColor,
    icons: [
      { src: './pwa-icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
      { src: './pwa-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
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
