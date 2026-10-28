import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { cappedDatabase } from './cappedDatabase'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('../src/lib/supabase', () => ({ sb: () => state.client }))
const { fetchRange, fetchTwoMonths } = await import('../src/lib/api')

describe('기간 내역 전체 조회', () => {
  it('1,000건을 넘어도 같은 날짜·생성 시각의 모든 내역을 ID 순서로 읽는다', async () => {
    state.client = cappedDatabase(1205).client
    const rows = await fetchRange('home', '2026-10-01', '2026-10-31')
    expect(rows).toHaveLength(1205)
    expect(new Set(rows.map((r) => r.id)).size).toBe(1205)
    expect(rows[0].id).toBe('tx-00001')
    expect(rows.at(-1)?.id).toBe('tx-01205')
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(12050)
  })

  it('서버가 요청보다 작은 묶음을 줘도 두 달 내역을 빠짐없이 최신 순으로 읽는다', async () => {
    state.client = cappedDatabase(8, 3).client
    const rows = await fetchTwoMonths('home', '2026-10')
    expect(rows.map((r) => r.id)).toEqual(['tx-00008', 'tx-00007', 'tx-00006', 'tx-00005', 'tx-00004', 'tx-00003', 'tx-00002', 'tx-00001'])
  })

  it('페이지를 읽는 중 오류가 나면 일부 내역을 성공으로 돌려주지 않는다', async () => {
    state.client = cappedDatabase(8, 3, 3).client
    await expect(fetchRange('home', '2026-10-01', '2026-10-31')).rejects.toThrow('page_failed')
  })

  it('다른 가구와 기간 밖 내역은 페이지를 늘려도 포함하지 않는다', async () => {
    const db = cappedDatabase(8, 3)
    db.rows[1].household_id = 'other'
    db.rows[4].occurred_on = '2026-09-30'
    state.client = db.client
    const rows = await fetchRange('home', '2026-10-01', '2026-10-31')
    expect(rows.map((r) => r.id)).toEqual(['tx-00001', 'tx-00003', 'tx-00004', 'tx-00006', 'tx-00007', 'tx-00008'])
  })

  it('기록이 없는 기간은 빈 목록이다', async () => {
    state.client = cappedDatabase(0).client
    expect(await fetchRange('home', '2026-10-01', '2026-10-31')).toEqual([])
  })
})
