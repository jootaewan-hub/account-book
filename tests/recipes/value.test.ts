// 확인 후보·고친 곳의 값 글(_shared/recipeValue.ts): 처리기가 쓰는 꼴과 사람이 적는 꼴을 모두 읽는다.
import { describe, expect, it } from 'vitest'
import {
  formatAmountValue, formatSecondsValue, formatServingsValue, parseAmountValue, parseSecondsValue, parseServingsValue, sameUnit,
} from '../../supabase/functions/_shared/recipeValue'

describe('분량 값', () => {
  it.each([
    ['2큰술', 2, '큰술'],
    ['1/2컵', 0.5, '컵'],
    ['½', 0.5, null],
    ['1½큰술', 1.5, '큰술'],
    ['1과 1/2컵', 1.5, '컵'],
    ['두 큰술', 2, '큰술'],
    ['반 컵', 0.5, '컵'],
    ['2T', 2, '큰술'],
    ['1t', 1, '작은술'],
    ['500g', 500, 'g'],
    ['2 개', 2, '개'],
    ['3스푼', 3, '스푼'],
    ['2', 2, null],
    ['0.5', 0.5, null],
    ['2인분', 2, '인분'],
  ])('%s → %s %s', (text, amount, unit) => {
    expect(parseAmountValue(text)).toEqual({ amount, unit })
  })

  it.each(['', '약간', '2~3큰술', '두세 큰술', '2큰술 3큰술', '0', '설탕 2큰술', '-1'])('%s는 읽지 않는다', (text) => {
    expect(parseAmountValue(text)).toBeNull()
  })

  it('처리기가 쓴 꼴을 그대로 다시 읽는다', () => {
    for (const [a, u] of [[2, '큰술'], [0.333, '컵'], [500, 'g'], [1, null]] as const) {
      expect(parseAmountValue(formatAmountValue(a, u))).toEqual({ amount: a, unit: u })
    }
  })
})

describe('인분 값', () => {
  it.each([['2인분', 2], ['2', 2], ['두 사람', 2], ['3인', 3], ['1.5인분', 1.5]])('%s → %s', (text, n) => {
    expect(parseServingsValue(text)).toBe(n)
  })
  it.each(['2큰술', '약간', '2~3인분', ''])('%s는 읽지 않는다', (text) => {
    expect(parseServingsValue(text)).toBeNull()
  })
  it('쓴 꼴을 다시 읽는다', () => {
    expect(parseServingsValue(formatServingsValue(4))).toBe(4)
  })
})

describe('시간 값', () => {
  it.each([['180', 180], ['3:00', 180], ['1:30', 90], ['1:02:05', 3725], ['3분', 180], ['1분 30초', 90], ['30초', 30], ['1시간 반', 5400]])('%s → %s초', (text, n) => {
    expect(parseSecondsValue(text)).toBe(n)
  })
  it.each(['0', '약간', '3분에서 5분', '2큰술', ''])('%s는 읽지 않는다', (text) => {
    expect(parseSecondsValue(text)).toBeNull()
  })
  it('쓴 꼴을 다시 읽는다', () => {
    expect(parseSecondsValue(formatSecondsValue(180))).toBe(180)
  })
})

describe('단위 견주기', () => {
  it('T와 큰술은 같고, 비면 같지 않다', () => {
    expect(sameUnit('T', '큰술')).toBe(true)
    expect(sameUnit('큰술', '컵')).toBe(false)
    expect(sameUnit(null, '큰술')).toBe(false)
  })
})
