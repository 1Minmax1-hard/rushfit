/* RushFit Service Worker（v19）
   目标：断网 / 弱网时也能立刻打开。
   1) 安装时逐个预缓存，单个资源失败不影响 index.html 入库；
   2) 页面导航「网络优先 + 2.5 s 超时回退缓存」：网络正常拿新版，断网或卡住就秒开缓存；
   3) 其余静态资源缓存优先 + 后台更新。 */
const CACHE = 'rushfit-v23';
const PAGE = './index.html';
const ASSETS = [
  './index.html',
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './icons/icon-maskable-512.png'
];

const NET_WAIT = 2500;          /* 导航最多等网络这么久，超时就用缓存 */

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* 逐个 add：任何一个 404 都不会让整批缓存失败（addAll 是原子的） */
    await Promise.all(ASSETS.map(u =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => {})
    ));
    /* 兜底再确认一次首页在缓存里 */
    const ok = await c.match(PAGE) || await c.match('./');
    if (!ok) {
      try {
        const res = await fetch(PAGE, { cache: 'reload' });
        if (res && res.ok) await c.put(PAGE, res.clone());
      } catch (err) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function putInCache(req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith((async () => {
      const cached = await caches.match(req) || await caches.match(PAGE) || await caches.match('./');
      const net = fetch(req).then(res => {
        if (res && res.ok) putInCache(req, res);
        return res;
      }).catch(() => null);

      if (!cached) {
        const res = await net;
        return res || new Response('当前处于离线状态，且本机还没有缓存页面。请联网后再打开一次。',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      /* 网络先回来就用新的；超过 2.5 s 还没回来，先用缓存把页面开起来，
         后台那次请求仍会把新版写进缓存，下次打开就是新的。 */
      const first = await Promise.race([net, delay(NET_WAIT).then(() => null)]);
      if (first && first.ok) return first;
      return cached;
    })());
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        putInCache(req, res);
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
