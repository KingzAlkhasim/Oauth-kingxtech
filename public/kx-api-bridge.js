const LEGACY_API = 'https://kx-neurocore-1066169621814.us-central1.run.app';
const params = new URL(self.location.href).searchParams;
const TARGET_API = (params.get('api') || '').replace(/\/+$/, '');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (!TARGET_API || !event.request.url.startsWith(LEGACY_API)) return;

  const target = TARGET_API + event.request.url.slice(LEGACY_API.length);
  const headers = new Headers(event.request.headers);
  const init = {
    method: event.request.method,
    headers,
    mode: 'cors',
    credentials: event.request.credentials,
    redirect: event.request.redirect,
    referrer: event.request.referrer,
    referrerPolicy: event.request.referrerPolicy,
  };

  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    init.body = event.request.clone().body;
  }

  event.respondWith(fetch(new Request(target, init)));
});
