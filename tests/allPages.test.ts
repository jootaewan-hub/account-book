import { describe, expect, it } from 'vitest'
import { readAllPages } from '../supabase/functions/_shared/pagination'

describe('전체 페이지 읽기의 실패 처리', () => {
  it('전체 개수가 없는 응답도 짧은 페이지 다음을 읽고 빈 페이지에서 끝낸다', async () => {
    const data = ['a', 'b', 'c', 'd', 'e']
    expect(await readAllPages(async (from) => ({ data: data.slice(from, from + 2), error: null }))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('처음 확인한 전체 개수보다 적게 읽었는데 빈 페이지가 오면 실패한다', async () => {
    await expect(readAllPages(async (from) => ({ data: from === 0 ? ['a', 'b'] : [], error: null, count: 3 }))).rejects.toThrow(/다시 시도/)
  })
  it('data가 없는 비정상 응답은 빈 기록으로 오인하지 않는다', async () => {
    await expect(readAllPages(async () => ({ data: null, error: null, count: 0 }))).rejects.toThrow(/불러오지 못했어요/)
  })
})
