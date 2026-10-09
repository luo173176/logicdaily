/* LogicDaily Service Worker
 * 策略：
 * - 应用外壳（导航请求）：stale-while-revalidate，离线时回退到缓存的首页或 /offline
 * - 静态资源（_next/static、图标、字体）：缓存优先，长期有效
 * - API 请求：一律走网络，不缓存（AI 调用避免重复计费，配置状态需要实时）
 * 数据本身存在 IndexedDB，因此离线可用的核心是外壳与题库分块，而不是缓存动态接口。
 */

const CACHE = 'logicdaily-v1';
const SHELL_URLS = ['/', '/offline', '/icons/icon-192.png', '/icons/icon-512.png'];
const STATIC_PREFIXES = ['/_next/static/', '/icons/', '/fonts/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isNavigation(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API 一律不缓存：AI 调用不能重复计费，配置状态也要实时。
  if (url.pathname.startsWith('/api/')) return;

  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (isNavigation(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const hit = await caches.match(request);
          if (hit) return hit;
          const shell = await caches.match('/');
          return shell || caches.match('/offline') || Response.error();
        }),
    );
    return;
  }

  // 其余同源 GET（含按路由拆分的 JS/CSS 分块）：网络优先，失败回落缓存
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || Response.error()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
