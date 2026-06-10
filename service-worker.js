// service-worker.js — Share Target + manifest dinámico por proyecto
// Versión: 3.0 — PS Tecales Marcador de Fotos

const CACHE_NAME = 'marcador-fotos-v3';
const BASE_SCOPE = '/marcas-agua-supervision/';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── 1. Manifest dinámico ─────────────────────────────────────────────────
  // El browser pide manifest.json con un header Referer que contiene la URL
  // actual de la página (incluyendo ?proyecto=X). Lo interceptamos y
  // devolvemos un JSON generado al vuelo con start_url y nombre correctos.
  if (url.pathname === BASE_SCOPE + 'manifest.json') {
    event.respondWith(servirManifestDinamico(event.request));
    return;
  }

  // ── 2. Share Target: POST con fotos desde la galería ────────────────────
  if (event.request.method === 'POST' && url.pathname === BASE_SCOPE) {
    event.respondWith(handleShareTarget(event.request, url));
    return;
  }

  // ── 3. Todo lo demás: red primero, caché como fallback ───────────────────
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Genera y devuelve el manifest.json con el proyecto correcto ─────────────
function servirManifestDinamico(request) {
  // Extraer ?proyecto= del Referer (la página que pidió el manifest)
  let proyecto = '';
  const referer = request.referrer || request.headers.get('Referer') || '';
  if (referer) {
    try {
      proyecto = new URL(referer).searchParams.get('proyecto') || '';
    } catch(e) {}
  }

  const appName   = proyecto ? 'Fotos · ' + proyecto : 'Marcador de Fotos';
  const shortName = proyecto ? proyecto               : 'Marcador Fotos';
  const startUrl  = proyecto
    ? BASE_SCOPE + '?proyecto=' + encodeURIComponent(proyecto)
    : BASE_SCOPE;

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
      action:  startUrl,
      method:  'POST',
      enctype: 'multipart/form-data',
      params:  { files: [{ name: 'images', accept: ['image/*'] }] }
    }
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-cache'
    }
  });
}

// ── Recibe las fotos compartidas desde la galería del sistema ───────────────
async function handleShareTarget(request, url) {
  const formData = await request.formData();
  const files    = formData.getAll('images');
  const proyecto = url.searchParams.get('proyecto') || '';

  if (files && files.length > 0) {
    const shareCache = await caches.open('share-target-queue');

    await shareCache.put(
      new Request('/_share-queue'),
      new Response(JSON.stringify({ count: files.length, proyecto }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buf  = await file.arrayBuffer();
      await shareCache.put(
        new Request('/_share-image-' + i),
        new Response(buf, {
          headers: {
            'Content-Type': file.type || 'image/jpeg',
            'X-File-Name':  file.name || ('foto_' + i + '.jpg')
          }
        })
      );
    }

    // Notificar a ventanas ya abiertas
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      await clients[0].focus();
      clients[0].postMessage({ type: 'SHARE_TARGET_FILES', count: files.length });
    }
  }

  const redirectUrl = BASE_SCOPE + '?from=share' +
    (proyecto ? '&proyecto=' + encodeURIComponent(proyecto) : '');
  return Response.redirect(redirectUrl, 303);
}
