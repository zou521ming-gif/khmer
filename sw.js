/* 离线缓存：有网时总是拿最新的程序文件，同时存一份在手机里；没网或网太慢时用存下来的那份 */
const CACHE = 'km-shell-v2';
const FILES = ['./', 'index.html', 'app.js', 'course.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // 谷歌和 Claude 的请求不经过这里
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    if (!hit) return net;
    net.catch(() => {});
    const slow = new Promise(res => setTimeout(() => res(hit), 3000));   // 等 3 秒还没回来就先用存下来的
    return Promise.race([net.catch(() => hit), slow]);
  }));
});
