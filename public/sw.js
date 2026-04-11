const CACHE_NAME = 'cinevault-v4'; // Increment to clear old caches
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-512.png',
  '/assets/logo.png'
];

// Instalar y forzar el control (skipWaiting)
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando nueva versión...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Limpiar cachés antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activado y limpiando cachés antiguos...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch events
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo cachear GET requests
  if (event.request.method !== 'GET') return;

  // Ignorar peticiones de API y streaming
  if (url.pathname.includes('/api/')) return;

  // ESTRATEGIA: Network-First para index.html y la raíz
  // Esto asegura que si hay red, SIEMPRE bajamos el HTML nuevo para ver los nuevos hashes de Vite
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ESTRATEGIA: Stale-While-Revalidate para el resto (imágenes, fuentes, etc.)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const cacheCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cacheCopy);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Si el fetch falla, devolver el cache o un error
          if (cachedResponse) return cachedResponse;
          return new Response('Network error', { status: 503 });
        });
      return cachedResponse || fetchPromise;
    })
  );
});
