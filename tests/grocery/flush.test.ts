import { describe, expect, it } from 'vitest'
import { trackGroceryFlush, waitGroceryFlush } from '../../src/grocery/flush'

const later = <T,>(ms: number, v: T, fail = false) =>
  new Promise<T>((ok, no) => setTimeout(() => (fail ? no(new Error('x')) : ok(v)), ms))

describe('로그아웃 전 장보기 빼기 기다리기', () => {
  it('등록한 요청이 끝나기 전에는 끝나지 않는다', async () => {
    const order: string[] = []
    void trackGroceryFlush(later(30, 1)).then(() => order.push('지우기'))
    await waitGroceryFlush()
    order.push('로그아웃')
    expect(order).toEqual(['지우기', '로그아웃'])
  })
  it('실패한 요청도 기다림을 막지 않는다', async () => {
    const p = trackGroceryFlush(later(10, 0, true)).catch(() => 'caught')
    await waitGroceryFlush()
    expect(await p).toBe('caught')
  })
  it('등록한 것이 없으면 바로 끝난다', async () => {
    await expect(waitGroceryFlush()).resolves.toBeUndefined()
  })
  it('기다리는 동안 새로 등록된 요청도 기다린다', async () => {
    let second = false
    void trackGroceryFlush(later(10, 1)).then(() => { void trackGroceryFlush(later(10, 2)).then(() => { second = true }) })
    await waitGroceryFlush()
    expect(second).toBe(true)
  })
})
