// Service Worker for Nourish45
// Think of this as a tiny helper that runs in the background on your phone.
// Its job is to cache (save) the app's files locally so it can open
// even when you have no internet connection.

const CACHE_NAME = "nourish45-v1";

// These are the core files we want saved on the device immediately
const CORE_FILES = ["/", "/index.html", "/manifest.json"];

// When the service worker first installs, cache the core files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_FILES))
  );
});

// When the app requests a file, try the network first (to get fresh data),
// and fall back to the cached version if there's no connection
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
