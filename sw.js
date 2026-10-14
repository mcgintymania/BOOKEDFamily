// Family Hub offline helper.
// - The app itself: fetched fresh each time, with the last copy kept for when there's no signal.
// - Household data: fresh when online; the last copy is shown when offline (read-only).
//   It's cleared when someone signs out, so the next person on this device can't see it.
// - Signing in, saving and live updates always go straight to Supabase, never from here.

const SHELL = 'fh-shell-v1';
const DATA = 'fh-data-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['./', './manifest.webmanifest', './icon-192.png']).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-data') event.waitUntil(caches.delete(DATA));
});

async function networkFirst(request, cacheName, key = request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(cacheName).then((c) => c.put(key, copy)).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match(key, { cacheName });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app page (any address inside the app opens the same page).
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    const root = new URL('./', self.registration.scope).href;
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((c) => c.put('./', copy)).catch(() => {});
          }
          return response;
        })
        .catch(async () => {
          // Offline: open the saved copy of the app at its home address (so it finds its feet).
          if (url.href.split('#')[0].split('?')[0] !== root) return Response.redirect(root, 302);
          return (await caches.match('./', { cacheName: SHELL })) || Response.error();
        })
    );
    return;
  }

  // Household data from Supabase's database API (reads only).
  if (url.pathname.includes('/rest/v1/') && url.hostname.endsWith('.supabase.co')) {
    event.respondWith(networkFirst(req, DATA));
    return;
  }

  // Icons and the manifest.
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
