// 실제 Supabase JS의 요청을 HTTP 경계에서 받는다. 서버의 행 제한·정렬·기간·가구 필터를 흉내 낸다.
import { createClient } from '@supabase/supabase-js'

export function cappedDatabase(size: number, cap = 1000, failFrom = Infinity) {
  const rows = Array.from({ length: size }, (_, i) => ({
    id: `tx-${String(i + 1).padStart(5, '0')}`, household_id: 'home', type: 'expense',
    occurred_on: '2026-10-12', occurred_at: null, amount: '10', title: `물건 ${i + 1}`, memo: null,
    category_id: null, payment_method_id: null, scope: 'shared', source: 'manual',
    created_by: 'me', created_at: '2026-10-12T10:00:00Z', recurring_id: null, recurring_month: null,
    platform: null, merchant: null, transaction_items: [], fuel_fills: null,
  }))
  const client = createClient('https://pagination.test', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      if (offset >= failFrom) return new Response(JSON.stringify({ message: 'page_failed', code: 'P0001', details: '', hint: '' }), { status: 400 })
      let selected = rows.filter((r) => [...url.searchParams].every(([k, v]) => {
        if (!(k in r) || !/^(eq|gte|lte)\./.test(v)) return true
        const actual = String(r[k as keyof typeof r])
        const value = v.slice(v.indexOf('.') + 1)
        return v.startsWith('eq.') ? actual === value : v.startsWith('gte.') ? actual >= value : actual <= value
      }))
      const ordering = (url.searchParams.get('order') ?? '').split(',').filter(Boolean)
      selected = selected.sort((a, b) => {
        for (const part of ordering) {
          const [key, direction] = part.split('.')
          const diff = String(a[key as keyof typeof a]).localeCompare(String(b[key as keyof typeof b]))
          if (diff) return direction === 'desc' ? -diff : diff
        }
        return 0
      })
      const total = selected.length
      const limit = Math.min(cap, Number(url.searchParams.get('limit') ?? cap))
      const page = selected.slice(offset, offset + limit)
      const counted = new Headers(init?.headers).get('prefer')?.includes('count=exact')
      return new Response(JSON.stringify(page), { headers: {
        'content-type': 'application/json',
        'content-range': `${offset}-${offset + page.length - 1}/${counted ? total : '*'}`,
      } })
    } },
  })
  return { client, rows }
}
