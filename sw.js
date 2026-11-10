/* SwoleQuest offline worker. Same file in every app except the APP, PAGES and FILES lines.
   Network first (4 s), stored copy as fallback. Same-origin GET inside this folder only. */
const APP = 'trenched-tracker'; // <- repo name
const PAGES = ['./'];  // pages to store at install (Essentials: ['./', 'original/'])
const FILES = []; // same-folder files the page loads, e.g. ['row-pull.jpg'] (best effort)
const CACHE = 'sq-' + APP + '-v1';
const PREFIX = 'sq-' + APP + '-';
const WAIT_MS = 4000;
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    for (const p of PAGES) {
      const pageUrl = new URL(p, SCOPE).href;
      const res = await fetch(pageUrl, { cache: 'no-cache' });
      if (res.status !== 200) throw new Error('page ' + res.status);
      await cache.put(pageUrl, res);
    }
    for (const f of FILES) { // best effort
      try {
        const href = new URL(f, SCOPE).href;
        const r = await fetch(href, { cache: 'no-cache' });
        if (r.status === 200) await cache.put(href, r);
      } catch (e) {}
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names.filter(function (n) { return n.indexOf(PREFIX) === 0 && n !== CACHE; })
      .map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

async function stored(req) {
  const cache = await caches.open(CACHE);
  let hit = await cache.match(req.url, { ignoreSearch: true });
  if (!hit) {
    const u = new URL(req.url);
    if (/\/index\.html$/.test(u.pathname)) { u.pathname = u.pathname.replace(/index\.html$/, ''); hit = await cache.match(u.href, { ignoreSearch: true }); }
  }
  if (!hit && req.mode === 'navigate') hit = await cache.match(SCOPE.href, { ignoreSearch: true });
  return hit;
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) return;
  if (/(^|\/)(v\.txt|sw\.js)$/.test(url.pathname)) return; // always straight to the network
  event.respondWith(new Promise(function (resolve) {
    let done = false;
    const finish = function (r) { if (!done) { done = true; resolve(r); } };
    const network = fetch(req.url, { cache: 'no-cache' }).then(async function (res) {
      if (res.status === 200 && !res.redirected) {
        const cache = await caches.open(CACHE);
        await cache.put(url.origin + url.pathname, res.clone()); // no query string: one entry per address
      }
      return res;
    });
    const timer = setTimeout(async function () {
      const hit = await stored(req);
      if (hit) finish(hit);
    }, WAIT_MS);
    network.then(function (res) {
      clearTimeout(timer);
      if (res.status >= 500) stored(req).then(function (hit) { finish(hit || res); });
      else finish(res);
    }, async function (err) {
      clearTimeout(timer);
      const hit = await stored(req);
      finish(hit || Response.error());
    });
    event.waitUntil(network.catch(function () {}));
  }));
});
