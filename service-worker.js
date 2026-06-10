// service-worker.js — Versión 12.0
// El manifest.json es estático — el SW ya no lo intercepta.
// El SW solo hace: procesar el POST del share target + persistir proyecto.

const CACHE_NAME   = 'marcador-fotos-v12';
const BASE_SCOPE   = '/marcas-agua-supervision/';
const PROYECTO_KEY = '/_sw-proyecto';

let proyectoActivo = '';

async function leerProyecto() {
  try {
    const c = await caches.open(CACHE_NAME);
    const r = await c.match(PROYECTO_KEY);
    if (r) proyectoActivo = (await r.text()).trim();
  } catch(e) {}
}

async function guardarProyecto(p) {
  proyectoActivo = p;
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(PROYECTO_KEY,
      new Response(p, { headers: { 'Content-Type': 'text/plain' } })
    );
  } catch(e) {}
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      c.addAll([BASE_SCOPE, BASE_SCOPE + 'index.html']).catch(() => {})
    )
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
      .then(() => leerProyecto())
  );
});

// ── Mensajes desde la página ──────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'SET_PROYECTO') guardarProyecto(event.data.proyecto || '');
});

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Share Target POST — interceptar y procesar fotos
  if (event.request.method === 'POST' && url.pathname === BASE_SCOPE) {
    event.respondWith(
      leerProyecto().then(() => handleShare(event.request))
    );
    return;
  }

  // Todo lo demás: red → caché
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Procesar fotos compartidas ────────────────────────────────────────────
async function handleShare(request) {
  let files = [];
  try {
    files = (await request.formData()).getAll('images');
  } catch(e) {
    console.warn('[SW] formData error:', e);
  }

  const proyecto = proyectoActivo;
  console.log('[SW] Share recibido. Proyecto:', proyecto, '| Fotos:', files.length);

  if (files.length > 0) {
    const q = await caches.open('share-target-queue');

    await q.put('/_share-queue',
      new Response(JSON.stringify({ count: files.length, proyecto }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );

    for (let i = 0; i < files.length; i++) {
      await q.put('/_share-image-' + i,
        new Response(await files[i].arrayBuffer(), {
          headers: {
            'Content-Type': files[i].type || 'image/jpeg',
            'X-File-Name':  files[i].name || 'foto_' + i + '.jpg'
          }
        })
      );
    }

    // Notificar si la app ya estaba abierta
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      clients[0].focus();
      clients[0].postMessage({ type: 'SHARE_TARGET_FILES', count: files.length });
    }
  }

  const destino = BASE_SCOPE + '?from=share' +
    (proyecto ? '&proyecto=' + encodeURIComponent(proyecto) : '');
  return Response.redirect(destino, 303);
}
