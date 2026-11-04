'use strict';
// Кэш файлов мини-приложения: открывается мгновенно и без сети (данные — из localStorage, их кладёт app.js).
// Страница — сначала из сети (чтобы новая версия приходила сразу), без сети — из кэша.
// Файлы с ?v= неизменны — сразу из кэша. Скрипт Telegram — из кэша, а в фоне обновляем.
// Запросы к серверу (Supabase) сюда не попадают: их не кэшируем.
const CACHE = 'dolgi-v1';
const PAGE = './';
const TG_JS = 'https://telegram.org/js/telegram-web-app.js';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll([PAGE])).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') return event.respondWith(page(req));
  if (url.href.startsWith(TG_JS)) return event.respondWith(fresh(req));
  if (url.origin !== location.origin) return;
  event.respondWith(url.searchParams.has('v') ? versioned(req) : fresh(req));
});

/** Страница: из сети; нет сети или она думает дольше 4 секунд — сохранённая копия (если её нет — ждём сеть) */
async function page(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(PAGE, res.clone());
    return res;
  });
  const saved = await cache.match(PAGE);
  if (!saved) return net;
  try {
    return await within(net, 4000);
  } catch {
    net.catch(() => {});
    return saved;
  }
}

/** app.js?v=…, styles.css?v=…: из кэша; новую версию кладём, старые копии того же файла удаляем */
async function versioned(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const path = new URL(req.url).pathname;
    for (const old of await cache.keys()) if (new URL(old.url).pathname === path) await cache.delete(old);
    await cache.put(req, res.clone());
  }
  return res;
}

/** Остальное: отдаём из кэша сразу, если есть, и обновляем в фоне */
async function fresh(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    update.catch(() => {});
    return hit;
  }
  return update;
}

function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(res => { clearTimeout(timer); resolve(res); }, err => { clearTimeout(timer); reject(err); });
  });
}
