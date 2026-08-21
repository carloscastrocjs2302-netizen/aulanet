const CACHE_NAME = 'aulanet-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './estilos.css',
  './config.js',
  './supabase-client.js',
  './auth.js',
  './router.js',
  './utils.js',
  './login.js',
  './primer-ingreso.js',
  './dashboard-director.js',
  './ficha-estudiante.js',
  './informe-pdf.js',
  './dashboard-coordinador-area.js',
  './dashboard-admin.js',
  './carga-excel.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Estrategia: red primero para todo lo que sea Supabase (datos siempre frescos);
// cache-first con fallback a red para el resto (shell de la app).
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.includes('supabase.co')) return; // nunca interceptar llamadas a la API

  event.respondWith(
    caches.match(event.request).then((cacheado) => {
      if (cacheado) return cacheado;
      return fetch(event.request).then((respuesta) => {
        if (respuesta.ok && event.request.method === 'GET') {
          const copia = respuesta.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        }
        return respuesta;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
