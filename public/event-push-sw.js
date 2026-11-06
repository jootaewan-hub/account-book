// Workbox가 만드는 PWA 서비스 워커에서 읽는다.
self.addEventListener('push', (event) => {
  let data
  try { data = event.data?.json() } catch { return }
  if (!data || data.kind !== 'event-reminder' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return

  const title = data.anniversary ? '가계부 기념일 알림' : '가계부 일정 알림'
  event.waitUntil(self.registration.showNotification(title, {
    body: '달력에서 다가오는 날짜를 확인해 주세요.',
    icon: new URL('icon-192.png', self.registration.scope).href,
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    data: { eventDate: data.date },
  }))
})

self.addEventListener('notificationclick', (event) => {
  const date = event.notification.data?.eventDate
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return

  event.notification.close()
  const url = new URL(self.registration.scope)
  url.searchParams.set('eventDate', date)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const current = windows.find((client) => client.url === url.href)
    if (current) await current.focus()
    else await self.clients.openWindow(url.href)
  })())
})
