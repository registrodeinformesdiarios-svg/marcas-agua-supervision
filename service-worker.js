// service-worker.js — Share Target + manifest dinámico por proyecto
// Versión: 5.0 — PS Tecales Marcador de Fotos

const CACHE_NAME   = 'marcador-fotos-v5';
const BASE_SCOPE   = '/marcas-agua-supervision/';
const SHARE_ACTION = '/marcas-agua-supervision/share';   // URL fija del share target

// Proyecto activo guardado en memoria del SW.
// Se actualiza via postMessage desde la página cada vez que carga.
let proyectoActivo = '';

// ── Instalación ────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  // Pre-cachear el shell de la app para que el SW pueda responder
  // a la action del share target aunque la red no esté disponible
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        BASE_SCOPE,
        BASE_SCOPE + 'index.html'
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

  // 1. Manifest dinámico — interceptar petición estática y devolver JSON al vuelo
  if (url.pathname === BASE_SCOPE + 'manifest.json') {
    event.respondWith(servirManifestDinamico(event.request));
    return;
  }

  // 2. Share Target POST — URL fija /share, siempre interceptada por el SW
  if (event.request.method === 'POST' && url.pathname === SHARE_ACTION) {
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
  // Prioridad 1: proyecto en memoria (enviado por postMessage desde la página)
  // Prioridad 2: Referer (respaldo)
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

  // La action del share_target es SIEMPRE la URL fija /share
  // (independiente del proyecto) para que el SW la intercepte de forma fiable.
  // El proyecto se recupera de proyectoActivo en memoria cuando llega el POST.
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
      action:  SHARE_ACTION,        // ← URL fija, no depende del proyecto
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
  const formData = await request.formData();
  const files    = formData.getAll('images');

  // El proyecto viene de la memoria del SW (set por postMessage cuando la app estaba abierta)
  // o del query string si el sistema lo incluyó
  const proyecto = proyectoActivo || url.searchParams.get('proyecto') || '';

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
