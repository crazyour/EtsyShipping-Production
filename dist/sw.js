// Replaces the old offline worker so existing local installs receive fresh deployments.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith("etsyshipping-")) await caches.delete(name);
  }
  await self.registration.unregister();
})()));
