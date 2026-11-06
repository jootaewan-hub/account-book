import webpush from 'npm:web-push@3.6.7'
import { admin } from '../_shared/edge.ts'
import { readAllPages } from '../_shared/pagination.ts'
import { anniversaryDates, handle, type Delivery } from './handle.ts'

const publicKey = Deno.env.get('EVENT_PUSH_PUBLIC_KEY') ?? ''
const privateKey = Deno.env.get('EVENT_PUSH_PRIVATE_KEY') ?? ''
const subject = Deno.env.get('EVENT_PUSH_SUBJECT') ?? ''
const secret = Deno.env.get('EVENT_REMINDERS_CRON_SECRET') ?? ''

Deno.serve((req) => handle(req, {
  now: () => new Date(),
  publicKey: privateKey && subject ? publicKey : '',
  secret,
  claim: async (now) => {
    const anniversaries = await readAllPages<Parameters<typeof anniversaryDates>[0][number]>((from, to) => admin
      .from('anniversaries')
      .select('id, lunar, month, day, repeat_unit, repeat_every, start_year, reminder_offset_minutes, reminder_active_since', { count: from === 0 ? 'exact' : undefined })
      .not('reminder_offset_minutes', 'is', null)
      .order('id')
      .range(from, to))
    const { data, error } = await admin.rpc('claim_event_push_deliveries', {
      p_now: now.toISOString(), p_anniversary_dates: anniversaryDates(anniversaries, now),
    })
    if (error) throw error
    return data as Delivery[]
  },
  send: async (d, payload, ttl) => {
    const request = webpush.generateRequestDetails(
      { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth_key } },
      JSON.stringify(payload),
      { vapidDetails: { subject, publicKey, privateKey }, TTL: ttl, topic: payload.tag },
    )
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.body,
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    await response.body?.cancel()
    return response.status
  },
  finish: async (d) => {
    const { error } = await admin.from('event_push_deliveries').update({ done_at: new Date().toISOString() })
      .eq('id', d.id).eq('lease_until', d.lease_until)
    if (error) throw error
  },
  dropDevice: async (d) => {
    const { error } = await admin.from('event_push_subscriptions').delete().eq('id', d.subscription_id)
      .eq('p256dh', d.p256dh).eq('auth_key', d.auth_key)
    if (error) throw error
  },
}))
