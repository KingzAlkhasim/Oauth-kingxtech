const LEGACY_API = 'https://kx-neurocore-1066169621814.us-central1.run.app';
const params = new URL(self.location.href).searchParams;
const TARGET_API = (params.get('api') || '').replace(/\/+$/, '');
const CACHE_NAME = 'kingxtech-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(new Request('/', { cache: 'reload' })))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (TARGET_API && url.href.startsWith(LEGACY_API)) {
    const target = TARGET_API + url.href.slice(LEGACY_API.length);
    const headers = new Headers(request.headers);
    const init = {
      method: request.method,
      headers,
      mode: 'cors',
      credentials: request.credentials,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.clone().body;
    event.respondWith(fetch(new Request(target, init)));
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && (request.mode === 'navigate' || response.type === 'basic')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
  );
});
