// service-worker.js — Versión 9.0
// Base: versión funcional original (POST a raíz)
// Agregado: proyecto persistido en Cache para sobrevivir reinicios del SW

const CACHE_NAME     = 'marcador-fotos-v9';
const PROYECTO_KEY   = '/_sw-proyecto-activo';
const BASE_SCOPE     = '/marcas-agua-supervision/';

// Variable en memoria — se restaura desde caché al despertar
let proyectoActivo = '';

// ── Al despertar, restaurar el proyecto guardado ──────────────────────────
async function restaurarProyecto() {
  try {
    const c   = await caches.open(CACHE_NAME);
    const res = await c.match(PROYECTO_KEY);
    if (res) proyectoActivo = await res.text();
  } catch(e) {}
}

// ── Guardar proyecto en caché (persiste aunque el SW se duerma) ───────────
async function persistirProyecto(proyecto) {
  proyectoActivo = proyecto;
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(PROYECTO_KEY, new Response(proyecto, {
      headers: { 'Content-Type': 'text/plain' }
    }));
  } catch(e) {}
}

// ── Instalación ────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([BASE_SCOPE, BASE_SCOPE + 'index.html']).catch(() => {})
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
      .then(() => restaurarProyecto())   // restaurar proyecto al activar
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

  // 2. Share Target POST a la raíz
  if (event.request.method === 'POST' && url.pathname === BASE_SCOPE) {
    event.respondWith(
      restaurarProyecto().then(() => handleShareTarget(event.request, url))
    );
    return;
  }

  // 3. Red primero, caché como fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Manifest dinámico ─────────────────────────────────────────────────────
function servirManifestDinamico(request) {
  // proyectoActivo ya fue restaurado antes de llamar esta función
  let proyecto = proyectoActivo;

  // Respaldo: leer del Referer si aún no hay proyecto en memoria
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
      action:  BASE_SCOPE,
      method:  'POST',
      enctype: 'multipart/form-data',
      params:  { files: [{ name: 'images', accept: ['image/*'] }] }
    }
  };

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }
  });
}

// ── Share Target: recibir fotos ───────────────────────────────────────────
async function handleShareTarget(request, url) {
  let files = [];
  try {
    const formData = await request.formData();
    files = formData.getAll('images');
  } catch(e) {
    console.warn('[SW] Error leyendo formData:', e);
  }

  // proyectoActivo ya fue restaurado desde caché antes de llegar aquí
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
