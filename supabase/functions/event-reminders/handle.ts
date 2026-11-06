import { occurrencesIn } from '../_shared/anniversaryOccurrences.ts'

const minute = 60_000
const kst = 9 * 60 * minute
const kstDate = (utcMs: number) => new Date(utcMs + kst).toISOString().slice(0, 10)
const windowMinutes = 10

type Anniversary = Parameters<typeof occurrencesIn>[0] & {
  id: string
  reminder_offset_minutes: number
  reminder_active_since: string
}
export interface AnniversaryDate {
  id: string
  occurs_on: string
  active_since: string
}

export function anniversaryDates(list: Anniversary[], now: Date): AnniversaryDate[] {
  return list.flatMap((a) => {
    const upper = now.getTime() + a.reminder_offset_minutes * minute
    const dates = new Set([kstDate(upper - windowMinutes * minute), kstDate(upper)])
    return [...dates].flatMap((date) => occurrencesIn(a, Number(date.slice(0, 4))).includes(date)
      ? [{ id: a.id, occurs_on: date, active_since: a.reminder_active_since }]
      : [])
  })
}

export interface Delivery {
  id: string
  subscription_id: string
  lease_until: string
  occurrence_date: string
  is_anniversary: boolean
  start_at: string
  endpoint: string
  p256dh: string
  auth_key: string
}

export interface Payload {
  kind: 'event-reminder'
  date: string
  anniversary: boolean
  tag: string
}

interface Deps {
  now: () => Date
  publicKey: string
  secret: string
  claim: (now: Date) => Promise<Delivery[]>
  send: (delivery: Delivery, payload: Payload, ttl: number) => Promise<number>
  finish: (delivery: Delivery) => Promise<void>
  dropDevice: (delivery: Delivery) => Promise<void>
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected || provided.length > 512) return false
  const encode = new TextEncoder()
  const [a, b] = await Promise.all([provided, expected].map(async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(v)))))
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method === 'GET') return deps.publicKey
    ? Response.json({ publicKey: deps.publicKey }, { headers: cors })
    : Response.json({ error: '알림 서버 설정이 필요해요.' }, { status: 503, headers: cors })
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  if (!(await secretMatches(req.headers.get('x-event-reminder-secret') ?? '', deps.secret))) {
    return new Response(null, { status: 401 })
  }
  if (!deps.publicKey) return new Response(null, { status: 503 })

  try {
    const now = deps.now()
    const deliveries = await deps.claim(now)
    const results = await Promise.allSettled(deliveries.map(async (d) => {
      const ttl = Math.min(windowMinutes * 60, Math.floor((Date.parse(d.start_at) - deps.now().getTime()) / 1000))
      if (ttl <= 0) return deps.finish(d)
      const tag = d.id.replace(/-/g, '')
      const status = await deps.send(d, { kind: 'event-reminder', date: d.occurrence_date, anniversary: d.is_anniversary, tag }, ttl)
      if (status === 404 || status === 410) return deps.dropDevice(d)
      if (status >= 200 && status < 300) return deps.finish(d)
      // 일시적인 전송 오류에서는 잠금이 풀리면 발송 시각 허용 범위 안에서 다시 시도한다.
      throw new Error('푸시 전송 실패')
    }))
    const retry = results.filter((r) => r.status === 'rejected').length
    return Response.json({ attempted: deliveries.length, retry }, { status: retry ? 207 : 200 })
  } catch {
    // 발송 대상의 식별자나 푸시 주소가 로그에 남지 않게 한다.
    return new Response(null, { status: 500 })
  }
}
