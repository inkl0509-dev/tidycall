/* Service worker: receives push notifications (Firebase Cloud Messaging) and keeps the app shell available. */
importScripts('/firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

if (self.FIREBASE_CONFIG && !/PASTE/.test(self.FIREBASE_CONFIG.apiKey || '')) {
  firebase.initializeApp(self.FIREBASE_CONFIG);
  // Notifications sent by the server include title/body, so Firebase shows them automatically
  // when the app is closed and opens the task link when tapped.
  firebase.messaging();
}

const CACHE = 'tidycall-v3';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/firebase.js', '/js/push.js',
  '/js/manager.js', '/js/staff.js', '/js/maps.js', '/js/badges-def.js', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first (so updates show immediately), cached copy when offline. API calls are never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// Tapping a notification that Firebase did not handle (fallback): focus the app or open it.
self.addEventListener('notificationclick', (e) => {
  if (e.notification.data && e.notification.data.FCM_MSG) return; // handled by Firebase
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('/');
  }));
});
