// service-worker.js — Versión 10.0
// - action del share_target siempre fija en /share-handler (diferente de start_url)
// - El SW la sirve directamente desde caché, sin tocar GitHub Pages
// - proyecto persistido en Cache API para sobrevivir reinicios del SW

const CACHE_NAME   = 'marcador-fotos-v10';
const BASE_SCOPE   = '/marcas-agua-supervision/';
const SHARE_ACTION = '/marcas-agua-supervision/share-handler';
const PROYECTO_KEY = '/_sw-proyecto-activo';

let proyectoActivo = '';

// ── Persistencia del proyecto ─────────────────────────────────────────────
async function restaurarProyecto() {
  try {
    const c   = await caches.open(CACHE_NAME);
    const res = await c.match(PROYECTO_KEY);
    if (res) proyectoActivo = (await res.text()).trim();
  } catch(e) {}
}

async function persistirProyecto(p) {
  proyectoActivo = p;
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(PROYECTO_KEY,
      new Response(p, { headers: { 'Content-Type': 'text/plain' } })
    );
  } catch(e) {}
}

// ── HTML mínimo que el SW sirve para la action del share target ───────────
// GitHub Pages nunca ve esta URL — el SW la intercepta siempre
const SHARE_HANDLER_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>...</title></head>
<body><script>window.location.replace('/marcas-agua-supervision/');<\/script></body>
</html>`;

// ── Instalación ────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Pre-cachear el shell y la URL de la action
      await cache.addAll([BASE_SCOPE, BASE_SCOPE + 'index.html']).catch(() => {});
      // Cachear el share-handler para que el SW siempre pueda responder a esa URL
      await cache.put(
        new Request(SHARE_ACTION),
        new Response(SHARE_HANDLER_HTML, {
          headers: { 'Content-Type': 'text/html' }
        })
      );
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== 'share-target-queue')
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => restaurarProyecto())
  );
});

// ── Mensajes desde la página ───────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SET_PROYECTO') {
    persistirProyecto(event.data.proyecto || '');
  }
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Manifest dinámico
  if (url.pathname === BASE_SCOPE + 'manifest.json') {
    event.respondWith(
      restaurarProyecto().then(() => servirManifestDinamico(event.request))
    );
    return;
  }

  // 2. Share Target POST — interceptado SIEMPRE por el SW (está en caché)
  if (event.request.method === 'POST' && url.pathname === SHARE_ACTION) {
    event.respondWith(
      restaurarProyecto().then(() => handleShareTarget(event.request, url))
    );
    return;
  }

  // 3. share-handler GET (por si el SO hace un GET de prueba)
  if (url.pathname === SHARE_ACTION) {
    event.respondWith(caches.match(SHARE_ACTION));
    return;
  }

  // 4. Red primero, caché como fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Manifest dinámico ──────────────────────────────────────────────────────
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
      action:  SHARE_ACTION,   // fija, diferente de start_url, servida por el SW
      method:  'POST',
      enctype: 'multipart/form-data',
      params:  { files: [{ name: 'images', accept: ['image/*'] }] }
    }
  };

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }
  });
}

// ── Procesar fotos compartidas ─────────────────────────────────────────────
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
      const buf = await files[i].arrayBuffer();
      await shareCache.put(
        new Request('/_share-image-' + i),
        new Response(buf, {
          headers: {
            'Content-Type': files[i].type || 'image/jpeg',
            'X-File-Name':  files[i].name || ('foto_' + i + '.jpg')
          }
        })
      );
    }

    // Si la app ya tiene una ventana abierta, notificarla
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
