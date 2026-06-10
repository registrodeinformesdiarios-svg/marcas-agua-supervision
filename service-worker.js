// service-worker.js — Share Target + PWA cache básico
// Versión: 1.0 — PS Tecales Marcador de Fotos

const CACHE_NAME = 'marcador-fotos-v1';

// ── Instalación: cachear el shell de la app ─────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        '/marcas-agua-supervision/',
        '/marcas-agua-supervision/index.html',
        '/marcas-agua-supervision/manifest.json'
      ]).catch(() => {
        // Si algún recurso falla al cachear, continuar igual
      })
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Share Target: interceptar fotos compartidas desde la galería ────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo interceptar POST al share target (raíz de la app)
  if (
    event.request.method === 'POST' &&
    url.pathname === '/marcas-agua-supervision/'
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Para el resto: red primero, luego caché
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

async function handleShareTarget(request) {
  // 1. Leer el FormData con las imágenes compartidas
  const formData = await request.formData();
  const files = formData.getAll('images');          // coincide con "name" en manifest.json

  if (files && files.length > 0) {
    // 2. Guardar los archivos temporalmente en la caché
    //    (se usa un key especial que la página principal va a leer)
    const shareCache = await caches.open('share-target-queue');
    await shareCache.put(
      new Request('/_share-queue'),
      new Response(JSON.stringify({ count: files.length }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );

    // 3. Guardar cada imagen individualmente
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

    // 4. Abrir o enfocar la ventana de la app y notificarle
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (clients.length > 0) {
      // Ya hay una ventana abierta — enfocarla y notificarle
      const client = clients[0];
      await client.focus();
      client.postMessage({ type: 'SHARE_TARGET_FILES', count: files.length });
    }
    // Si no hay ventana abierta, la redirección de abajo la abrirá
    // y onload() detectará la cola
  }

  // 5. Redirigir a la app (abre/enfoca la página principal)
  return Response.redirect('/marcas-agua-supervision/?from=share', 303);
}
