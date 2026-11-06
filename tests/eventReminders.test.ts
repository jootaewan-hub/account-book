import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { anniversaryDates, handle, type Delivery } from '../supabase/functions/event-reminders/handle'

const now = new Date('2026-02-10T00:00:00Z')
const delivery: Delivery = {
  id: '00000000-0000-4000-8000-00000000000a', subscription_id: 'device', lease_until: 'lease',
  occurrence_date: '2026-02-17', start_at: '2026-02-17T00:00:00Z', is_anniversary: true,
  endpoint: 'https://web.push.apple.com/secret', p256dh: 'key', auth_key: 'secret',
}
const deps = () => ({
  now: () => now,
  publicKey: 'public',
  secret: 'cron-only-secret',
  claim: vi.fn(async () => [delivery]),
  send: vi.fn(async () => 201),
  finish: vi.fn(async () => {}),
  dropDevice: vi.fn(async () => {}),
})
const request = (method: string, secret?: string) => new Request('https://example.com/event-reminders', {
  method, headers: secret ? { 'x-event-reminder-secret': secret } : {},
})

describe('푸시 발송 함수', () => {
  it('음력 설과 양력 월 반복의 회차를 달력과 같은 방식으로 고른다', () => {
    const base = { reminder_offset_minutes: 10080, reminder_active_since: '2026-01-01T00:00:00Z' }
    expect(anniversaryDates([
      { ...base, id: '설', lunar: true, month: 1, day: 1 },
      { ...base, id: '월반복', lunar: false, month: 12, day: 17, repeat_unit: 'month', repeat_every: 2, start_year: 2025 },
      { ...base, id: '미해당', lunar: false, month: 12, day: 17, repeat_unit: 'month', repeat_every: 3, start_year: 2025 },
    ], now)).toEqual(['설', '월반복'].map((id) => ({ id, occurs_on: '2026-02-17', active_since: base.reminder_active_since })))
  })

  it('공개 키만 읽을 수 있고 예약 키 없이는 발송 목록에도 접근하지 않는다', async () => {
    const d = deps()
    expect(await (await handle(request('GET'), d)).json()).toEqual({ publicKey: 'public' })
    expect((await handle(request('POST'), d)).status).toBe(401)
    expect((await handle(request('POST', 'wrong'), d)).status).toBe(401)
    expect(d.claim).not.toHaveBeenCalled()
  })

  it('개인 내용이 없는 메시지를 보내고 성공 기록을 남긴다', async () => {
    const d = deps()
    expect((await handle(request('POST', d.secret), d)).status).toBe(200)
    expect(d.send).toHaveBeenCalledWith(delivery, {
      kind: 'event-reminder', date: '2026-02-17', anniversary: true, tag: '0000000000004000800000000000000a',
    }, 600)
    expect(d.finish).toHaveBeenCalledWith(delivery)
  })

  it('만료 기기는 지우고 일시 오류는 재시도를 위해 남긴다', async () => {
    const d = deps()
    d.send.mockResolvedValueOnce(410).mockResolvedValueOnce(503)
    await handle(request('POST', d.secret), d)
    expect(d.dropDevice).toHaveBeenCalledWith(delivery)
    expect((await handle(request('POST', d.secret), d)).status).toBe(207)
    expect(d.finish).not.toHaveBeenCalled()
  })
})

it('서비스 워커가 푸시를 표시하고 알림을 누르면 앱 경로 안의 해당 날짜로 연다', async () => {
  const callbacks = new Map<string, (event: unknown) => void>()
  const showNotification = vi.fn()
  const openWindow = vi.fn()
  const waitUntil = vi.fn<(p: Promise<void>) => void>()
  const close = vi.fn()
  runInNewContext(readFileSync(new URL('../public/event-push-sw.js', import.meta.url), 'utf8'), {
    URL,
    self: {
      addEventListener: (name: string, cb: (event: unknown) => void) => callbacks.set(name, cb),
      registration: { scope: 'https://example.com/account-book/', showNotification },
      clients: { matchAll: async () => [], openWindow },
    },
  })
  callbacks.get('push')?.({ data: { json: () => ({ kind: 'event-reminder', date: '2026-02-17', anniversary: true }) }, waitUntil })
  expect(showNotification).toHaveBeenCalledWith('가계부 기념일 알림', expect.objectContaining({
    icon: 'https://example.com/account-book/icon-192.png', data: { eventDate: '2026-02-17' },
  }))
  callbacks.get('notificationclick')?.({ notification: { data: { eventDate: '2026-02-17' }, close }, waitUntil })
  await waitUntil.mock.lastCall?.[0]
  expect(close).toHaveBeenCalled()
  expect(openWindow).toHaveBeenCalledWith('https://example.com/account-book/?eventDate=2026-02-17')
})
