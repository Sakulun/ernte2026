// Service Worker – "network-first" für eigene Dateien.
// Zweck: Browser laden immer die neueste App-Version (kein Hard-Reload mehr nötig).
// Nur gleiche Herkunft (eigene HTML/JS/CSS) wird abgefangen – Supabase-API,
// WebSockets und CDN-Skripte (jsdelivr/unpkg/cloudflare) bleiben unberührt.
const CACHE = 'ernte-cache-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // fremde Origins durchlassen

  e.respondWith(
    // Immer zuerst frisch aus dem Netz (HTTP-Cache umgehen), Cache nur als Offline-Fallback.
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
