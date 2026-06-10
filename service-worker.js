// service-worker.js — Share Target + PWA cache básico
// Versión: 2.0 — PS Tecales Marcador de Fotos (proyecto dinámico)

const CACHE_NAME = 'marcador-fotos-v2';
const BASE_SCOPE = '/marcas-agua-supervision/';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        BASE_SCOPE,
        BASE_SCOPE + 'index.html',
        BASE_SCOPE + 'manifest.json'
      ]).catch(() => {})
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Share Target: interceptar fotos compartidas desde la galería ────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Interceptar cualquier POST al scope (con o sin ?proyecto=)
  if (event.request.method === 'POST' && url.pathname === BASE_SCOPE) {
    event.respondWith(handleShareTarget(event.request, url));
    return;
  }

  // Para el resto: red primero, luego caché
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

async function handleShareTarget(request, url) {
  const formData = await request.formData();
  const files    = formData.getAll('images');

  // Preservar el parámetro ?proyecto= si viene en la URL del share target
  const proyecto = url.searchParams.get('proyecto') || '';

  if (files && files.length > 0) {
    const shareCache = await caches.open('share-target-queue');

    // Guardar metadatos de la cola
    await shareCache.put(
      new Request('/_share-queue'),
      new Response(JSON.stringify({ count: files.length, proyecto }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );

    // Guardar cada imagen
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const arrayBuffer = await file.arrayBuffer();
      await shareCache.put(
        new Request(`/_share-image-${i}`),
        new Response(arrayBuffer, {
          headers: {
            'Content-Type': file.type || 'image/jpeg',
            'X-File-Name': file.name || `foto_${i}.jpg`
          }
        })
      );
    }

    // Notificar a ventanas ya abiertas
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      const client = clients[0];
      await client.focus();
      client.postMessage({ type: 'SHARE_TARGET_FILES', count: files.length });
    }
  }

  // Redirigir a la app preservando ?proyecto=
  const redirectUrl = BASE_SCOPE + '?from=share' + (proyecto ? '&proyecto=' + encodeURIComponent(proyecto) : '');
  return Response.redirect(redirectUrl, 303);
}
