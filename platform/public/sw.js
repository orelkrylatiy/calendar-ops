const CACHE='calendar-ops-shell-v4'
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE)
  const response=await fetch('/',{cache:'reload'})
  if(!response.ok)throw new Error('Shell unavailable')
  const html=await response.clone().text()
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m=>m[1])
  await cache.put('/',response)
  await cache.addAll([...new Set(assets.concat(['/manifest.webmanifest','/icon.svg']))])
  await self.skipWaiting()
})()))
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('calendar-ops-shell-')&&key!==CACHE)await caches.delete(key)
  await self.clients.claim()
})()))
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url)
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return
  if(event.request.mode==='navigate'&&['/','/calendar'].includes(url.pathname)){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/')));return
  }
  if(url.pathname.startsWith('/assets/')||['/icon.svg','/manifest.webmanifest'].includes(url.pathname)){
    event.respondWith((async()=>{
      const cached=await caches.match(event.request)
      if(cached)return cached
      const response=await fetch(event.request)
      if(response.ok){const cache=await caches.open(CACHE);await cache.put(event.request,response.clone())}
      return response
    })())
  }
})
