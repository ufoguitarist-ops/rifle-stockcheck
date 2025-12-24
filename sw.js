const CACHE='rifle-stockcheck-v3';
const ASSETS=[
  './','./index.html','./styles.css','./app.js','./csv.js','./idb.js','./sw.js','./manifest.webmanifest',
  './icon-192.png','./icon-512.png','./icon-180.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', (event)=>{ event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (event)=>{
  event.respondWith(caches.match(event.request).then(cached=>cached || fetch(event.request)));
});
