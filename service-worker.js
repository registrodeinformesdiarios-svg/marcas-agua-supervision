// service-worker.js — Share Target + manifest dinámico por proyecto
// Versión: 6.0 — PS Tecales Marcador de Fotos

const CACHE_NAME   = 'marcador-fotos-v6';
const BASE_SCOPE   = '/marcas-agua-supervision/';
const SHARE_ACTION = '/marcas-agua-supervision/share/';

let proyectoActivo = '';

// ── Instalación: pre-cachear el shell + la URL del share target ───────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Cachear index.html y share/index.html para que el SW pueda
      // responder aunque GitHub Pages devuelva 404 en el POST
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

// ── Mensajes desde la página ───────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SET_PROYECTO') {
    proyectoActivo = event.data.proyecto || '';
    console.log('[SW] Proyecto activo:', proyectoActivo || '(ninguno)');
  }
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const pathname = url.pathname.replace(/\/?$/, '/'); // normalizar trailing slash

  // 1. Manifest dinámico
  if (url.pathname === BASE_SCOPE + 'manifest.json') {
    event.respondWith(servirManifestDinamico(event.request));
    return;
  }

  // 2. Share Target POST — interceptar antes de que llegue a la red
  if (event.request.method === 'POST' &&
      (url.pathname === SHARE_ACTION || url.pathname === SHARE_ACTION.slice(0, -1))) {
    event.respondWith(handleShareTarget(event.request, url));
    return;
  }

  // 3. Red primero, caché como fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Genera manifest.json dinámico con el proyecto correcto ────────────────
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
      action:  SHARE_ACTION,
      method:  'POST',
      enctype: 'multipart/form-data',
      params:  { files: [{ name: 'images', accept: ['image/*'] }] }
    }
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type':  'application/manifest+json',
      'Cache-Control': 'no-cache'
    }
  });
}

// ── Recibe fotos compartidas desde la galería del sistema ──────────────────
async function handleShareTarget(request, url) {
  let files = [];
  try {
    const formData = await request.formData();
    files = formData.getAll('images');
  } catch(e) {
    console.warn('[SW] Error leyendo formData:', e);
  }

  const proyecto = proyectoActivo || url.searchParams.get('proyecto') || '';

  if (files.length > 0) {
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

    // Notificar si la app ya tiene una ventana abierta
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      await clients[0].focus();
      clients[0].postMessage({ type: 'SHARE_TARGET_FILES', count: files.length });
    }
  }

  // Redirigir a la app con el proyecto correcto
  const redirectUrl = BASE_SCOPE + '?from=share' +
    (proyecto ? '&proyecto=' + encodeURIComponent(proyecto) : '');
  return Response.redirect(redirectUrl, 303);
}
