import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { cappedDatabase } from './cappedDatabase'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null, handler: null as ((req: Request) => Promise<Response>) | null }))
vi.mock('@supabase/supabase-js', async (load) => {
  const actual = await load<typeof import('@supabase/supabase-js')>()
  return { ...actual, createClient: (...args: Parameters<typeof actual.createClient>) => args[0] === 'https://edge-export.test' ? state.client : actual.createClient(...args) }
})
beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({ SUPABASE_URL: 'https://edge-export.test', SUPABASE_SECRET_KEYS: '{"default":"test-secret"}' })[key] },
    serve: (handler: (req: Request) => Promise<Response>) => { state.handler = handler },
  })
  // Deno 진입점의 타입은 deno check로 확인한다. 브라우저 tsc의 검사 대상에 섞지 않는다.
  const entry = '../supabase/functions/export-csv/index'
  await import(entry)
})
afterAll(() => vi.unstubAllGlobals())

it('구글 시트용 함수도 작은 서버 행 제한 뒤의 내역을 끝까지 CSV에 넣는다', async () => {
  state.client = cappedDatabase(1205, 200).client
  const response = await state.handler!(new Request(`https://edge-export.test/export?t=${'a'.repeat(64)}`))
  expect(response.status).toBe(200)
  const csv = await response.text()
  expect(csv.trim().split('\n')).toHaveLength(1206)
  expect(csv).toContain('물건 1205')
})

it('시트용 함수의 중간 페이지가 실패하면 일부 CSV 대신 오류를 반환한다', async () => {
  state.client = cappedDatabase(1205, 200, 200).client
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const response = await state.handler!(new Request(`https://edge-export.test/export?t=${'a'.repeat(64)}`))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('내역을 읽지 못했어요')
  } finally { log.mockRestore() }
})
