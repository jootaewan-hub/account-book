// 지난 기록 읽기(D-042, supabaseStore.seenRecords): 가격 캡처를 못 읽어도 가계부 기록은 보이고, 가계부를 못 읽으면 던진다
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseStore } from '../../src/grocery/lib/supabaseStore'

/** 어떤 메서드를 불러도 자기를 돌려주고, await하면 result를 주는 PostgREST 흉내 */
function chain(result: { data: unknown; error: unknown }) {
  const p: unknown = new Proxy(() => {}, {
    get: (_t, k) => (k === 'then' ? (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad) : () => p),
  })
  return p
}
const me = { householdId: 'h1', userId: 'u1' } as never
const tx = [{ occurred_on: '2026-10-14', platform: null, title: '이마트 분당점', source: 'photo',
  transaction_items: [{ name: '서울우유 1L', quantity: 1, unit_price: 2980, amount: 2980, pack_size: 1000, pack_unit: 'ml' }] }]

function store(txResult: { data: unknown; error: unknown }, capResult: { data: unknown; error: unknown }) {
  const client = { from: () => chain(txResult), schema: () => ({ from: () => chain(capResult) }) } as unknown as SupabaseClient
  return createSupabaseStore(client, me)
}

describe('지난 기록 읽기', () => {
  it('가격 캡처 조회가 실패해도 영수증 기록은 돌려준다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = await store({ data: tx, error: null }, { data: null, error: { message: 'embed failed' } }).seenRecords()
    expect(rows.map((r) => [r.source, r.name])).toEqual([['receipt', '서울우유 1L']])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('캡처는 상품 이름으로, 가계부 조회가 실패하면 던진다', async () => {
    const rows = await store({ data: [], error: null }, { data: [{ seller: '쿠팡', price: 19800, qty: 2, delivery: 0, captured_on: '2026-10-30', products: { name: '비비고 왕교자 1.05kg' } }], error: null }).seenRecords()
    expect(rows).toEqual([expect.objectContaining({ source: 'capture', where: '쿠팡', name: '비비고 왕교자 1.05kg', quantity: 2, amount: 19800, delivery: 0 })])
    await expect(store({ data: null, error: new Error('denied') }, { data: [], error: null }).seenRecords()).rejects.toThrow('denied')
  })

  it('구매 기록은 가구와 기간을 거른 뒤 서버가 첫 페이지를 잘라 보내도 다음 페이지를 읽는다', async () => {
    const purchasePages = vi.fn((start: number) => Promise.resolve({
      data: [{ ...tx[0], occurred_on: start ? '2026-10-15' : '2026-10-14' }], count: start === 0 ? 2 : null, error: null,
    }))
    const calls: unknown[][] = []
    const purchases: unknown = new Proxy({}, { get: (_target, key) => key === 'range' ? purchasePages : (...args: unknown[]) => {
      calls.push([key, ...args])
      return purchases
    } })
    const client = { from: () => purchases, schema: () => ({ from: () => chain({ data: null, error: { message: 'offline' } }) }) } as unknown as SupabaseClient
    const result = await createSupabaseStore(client, me).purchaseHistory({ from: '2026-10-01', to: '2026-10-31' })
    expect(result.rows.map((r) => r.date)).toEqual(['2026-10-14', '2026-10-15'])
    expect(result.capturesAvailable).toBe(false)
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', 'household_id', 'h1'], ['eq', 'type', 'expense'], ['gte', 'occurred_on', '2026-10-01'], ['lte', 'occurred_on', '2026-10-31'], ['order', 'id'],
    ]))
    expect(purchasePages.mock.calls).toEqual([[0, 499], [1, 500]])
  })
})
