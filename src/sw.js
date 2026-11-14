// Service worker template. The build replaces the two placeholders below
// (see offlineShell in vite.config.ts) and writes the result to dist/sw.js.
const SHELL_CACHE = 'musuk-shell-__SHELL_VERSION__'
const SHELL_FILES = __SHELL_FILES__

self.addEventListener('install', (event) => {
  event.waitUntil(
    // No skipWaiting: a new version takes over the next time the app is opened,
    // never while you are in the middle of something.
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Also clears the old "damian-music-v*" caches, which held the songs that now live on the Songs site.
      .then((keys) => Promise.all(keys
        .filter((key) => key !== SHELL_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function shell(request) {
  const cache = await caches.open(SHELL_CACHE)
  // Match on the address alone: some hosts add "Vary: Origin", which would
  // otherwise make the cached app files miss for <script crossorigin> requests.
  const options = { ignoreSearch: true, ignoreVary: true }
  if (request.mode === 'navigate') {
    // Every page is the same single-page app.
    return (await cache.match('/', options)) ?? fetch(request)
  }
  return (await cache.match(new URL(request.url).pathname, options)) ?? fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  event.respondWith(shell(request))
})
