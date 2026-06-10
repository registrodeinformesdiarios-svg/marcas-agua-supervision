// service-worker.js — manifest dinámico por proyecto
// Versión: 7.0 — Share Target via GET (compatible con GitHub Pages)

const CACHE_NAME = 'marcador-fotos-v7';
const BASE_SCOPE = '/marcas-agua-supervision/';

let proyectoActivo = '';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        BASE_SCOPE,
        BASE_SCOPE + 'index.html',
        BASE_SCOPE + 'share/',
        BASE_SCOPE + 'share/index.html'
      ]).catch(() => {})
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SET_PROYECTO') {
    proyectoActivo = event.data.proyecto || '';
  }
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Manifest dinámico
  if (url.pathname === BASE_SCOPE + 'manifest.json') {
    event.respondWith(servirManifestDinamico(event.request));
    return;
  }

  // Red primero, caché como fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

function servirManifestDinamico(request) {
  let proyecto = proyectoActivo;
  if (!proyecto) {
    const referer = request.referrer || request.headers.get('Referer') || '';
    if (referer) {
      try { proyecto = new URL(referer).searchParams.get('proyecto') || ''; } catch(e) {}
    }
  }

  const appName   = proyecto ? 'Fotos · ' + proyecto : 'Marcador de Fotos';
  const shortName = proyecto ? proyecto               : 'Marcador Fotos';
  const startUrl  = proyecto
    ? BASE_SCOPE + '?proyecto=' + encodeURIComponent(proyecto)
    : BASE_SCOPE;

  // share_target con GET: el SO abre una URL normal, GitHub Pages la sirve,
  // share/index.html lee los parámetros y transfiere las imágenes a la app.
  const manifest = {
    name:             appName,
    short_name:       shortName,
    description:      'Generador de marcas de agua para reportes de obra PS Tecales',
    start_url:        startUrl,
    scope:            BASE_SCOPE,
    display:          'standalone',
    background_color: '#f3f4f6',
    theme_color:      '#1d4ed8',
    icons: [
      { src: BASE_SCOPE + 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: BASE_SCOPE + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ],
    share_target: {
      action: BASE_SCOPE + 'share/',
      method: 'GET',
      params: {
        files: [{ name: 'images', accept: ['image/*'] }]
      }
    }
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type':  'application/manifest+json',
      'Cache-Control': 'no-cache'
    }
  });
}
