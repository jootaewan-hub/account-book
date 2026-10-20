import { describe, expect, it } from 'vitest'
import { fitRule, fitVariants, isBulk, parseSize, splitCandidates } from '../../supabase/functions/_shared/fit'

const cand = (name: string, qtys: number[] = [1]) => ({ name, variants: qtys.map((qty) => ({ qty, price: qty * 1000 })) })

describe('상품 이름에서 크기 읽기', () => {
  it('무게·부피는 g·ml로 합치고, 곱(x 2개, ×3, 6병)을 곱한다', () => {
    expect(parseSize('CJ제일제당 비비고 왕교자 1.05kg')).toEqual({ family: 'mass', n: 1050 })
    expect(parseSize('CJ제일제당 비비고 왕교자 1.925kg')).toEqual({ family: 'mass', n: 1925 })
    expect(parseSize('CJ제일제당 비비고 왕교자 1.05kg x 2개+김치 왕교자 420g x 2개')).toEqual({ family: 'mass', n: 2940 })
    expect(parseSize('CJ제일제당 비비고 왕교자 420g x 2 + 김치 왕교자 420g x 2')).toEqual({ family: 'mass', n: 1680 })
    expect(parseSize('예시 볶음밥 3종 세트(300g×3)')).toEqual({ family: 'mass', n: 900 })
    expect(parseSize('제주 삼다수 2L x 6')).toEqual({ family: 'volume', n: 12000 })
    expect(parseSize('제주 삼다수 500ml 20병')).toEqual({ family: 'volume', n: 10000 })
    expect(parseSize('서울우유 나100% 1L')).toEqual({ family: 'volume', n: 1000 })
  })
  it('개수 단위(구·롤·개입)는 count, 크기 표시가 없으면 null', () => {
    expect(parseSize('풀무원 동물복지 계란 30구')).toEqual({ family: 'count', n: 30 })
    expect(parseSize('깨끗한나라 3겹 화장지 30롤')).toEqual({ family: 'count', n: 30 })
    expect(parseSize('농심 신라면 5개입')).toEqual({ family: 'count', n: 5 })
    expect(parseSize('예시 볶음밥 3종 세트')).toBeNull()
    expect(parseSize('대파')).toBeNull()
  })
})

describe('품목의 기준(fitRule): 한 봉지의 완전 대용량 선과 수량 줄의 합계 선', () => {
  it('표에 있는 품목은 표의 선, 직접 적은 규격이 더 크면 규격의 1.5배. 합계 선은 담은 양(규격 × 개수, 없으면 표 값)의 2배', () => {
    expect(fitRule('쌀', null, 1)).toEqual({ line: { family: 'mass', n: 10000 }, total: { family: 'mass', n: 20000 }, unlimited: false })
    expect(fitRule('비비고 왕교자', '1.05kg', 2)).toEqual({ line: { family: 'mass', n: 1575 }, total: { family: 'mass', n: 4200 }, unlimited: false })
    expect(fitRule('만두', '2kg', 1)).toEqual({ line: { family: 'mass', n: 3000 }, total: { family: 'mass', n: 4000 }, unlimited: false })
    expect(fitRule('우유', '900ml', 1).line).toEqual({ family: 'volume', n: 2500 })
  })
  it('표에 없으면 규격의 2.5배, 둘 다 없거나 판매 단위 규격(1/2포기)이면 선이 없다', () => {
    expect(fitRule('마요네즈', '500g', 1)).toEqual({ line: { family: 'mass', n: 1250 }, total: { family: 'mass', n: 1000 }, unlimited: false })
    expect(fitRule('마요네즈', null, 1)).toEqual({ line: null, total: null, unlimited: false })
    expect(fitRule('배추', '1/2포기', 1).line).toBeNull()
  })
  it('휴지·화장지는 큰 것으로 사므로 크기로 거르지 않는다(사용자 2026-10-20)', () => {
    expect(fitRule('두루마리 휴지', null, 1).unlimited).toBe(true)
    expect(fitRule('화장지', '30롤', 1).unlimited).toBe(true)
  })
})

describe('큰 용량·묶음 가르기', () => {
  it('사용자 예(2026-10-20): 쌀 10kg·생수 2L×6·우유 1.8L·간장 3L(보통 크기)는 보이고, 만두 2kg·된장 14kg·간장 13L는 숨긴다', () => {
    expect(isBulk(cand('이천쌀 10kg'), fitRule('쌀', null, 1))).toBe(false)
    expect(isBulk(cand('이천쌀 20kg'), fitRule('쌀', null, 1))).toBe(true)
    expect(isBulk(cand('제주 삼다수 2L x 6'), fitRule('생수', null, 1))).toBe(false)
    expect(isBulk(cand('제주 삼다수 2L x 12'), fitRule('생수', null, 1))).toBe(true)
    expect(isBulk(cand('서울우유 1.8L'), fitRule('우유', '900ml', 1))).toBe(false)
    expect(isBulk(cand('서울우유 2.3L'), fitRule('우유', '900ml', 1))).toBe(false)
    expect(isBulk(cand('서울우유 3L'), fitRule('우유', '900ml', 1))).toBe(true)
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 2kg'), fitRule('비비고 왕교자', '1.05kg', 2))).toBe(true)
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 1.925kg'), fitRule('비비고 왕교자', '1.05kg', 2))).toBe(true)
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 1.05kg'), fitRule('비비고 왕교자', '1.05kg', 2))).toBe(false)
    expect(isBulk(cand('비비고 왕교자 2kg'), fitRule('만두', '2kg', 1))).toBe(false) // 직접 2kg라고 적으면 보인다
    expect(isBulk(cand('해찬들 된장 14kg'), fitRule('된장', null, 1))).toBe(true)
    expect(isBulk(cand('샘표 간장 3L'), fitRule('간장', null, 1))).toBe(false)
    expect(isBulk(cand('샘표 간장 13L 업소용'), fitRule('간장', null, 1))).toBe(true)
    expect(isBulk(cand('샘표 간장 13L'), fitRule('간장', null, 1))).toBe(true)
  })
  it('휴지는 예외, 업소용·대용량·박스는 크기와 상관없이 숨김(예외 품목은 빼고), 표·규격이 없으면 3kg·3L·50개를 넘을 때만', () => {
    expect(isBulk(cand('깨끗한나라 화장지 30롤 x 2'), fitRule('두루마리 휴지', null, 1))).toBe(false)
    expect(isBulk(cand('대용량 화장지 60롤'), fitRule('휴지', null, 1))).toBe(false)
    expect(isBulk(cand('업소용 왕교자 1kg'), fitRule('비비고 왕교자', '1.05kg', 1))).toBe(true)
    expect(isBulk(cand('오뚜기 마요네즈 3.2kg'), fitRule('마요네즈', null, 1))).toBe(true)
    expect(isBulk(cand('오뚜기 마요네즈 1kg'), fitRule('마요네즈', null, 1))).toBe(false)
    expect(isBulk(cand('오뚜기 마요네즈 1.5kg'), fitRule('마요네즈', '500g', 1))).toBe(true) // 규격의 2.5배(1.25kg)를 넘음
    expect(isBulk(cand('풀무원 계란 60구'), fitRule('무슨 계란', null, 1))).toBe(true) // 표 선 30구
    expect(isBulk(cand('예시 볶음밥 3종 세트'), fitRule('냉동볶음밥', null, 1))).toBe(false)
  })
  it('수량 줄은 담은 양의 2배까지, 크기를 모르면 3개까지, 다 걸러지면 가장 적은 줄 하나, 예외 품목은 전부', () => {
    const r2 = fitRule('비비고 왕교자', '1.05kg', 2)
    expect(fitVariants(cand('CJ제일제당 비비고 왕교자 1.05kg', [1, 2, 3, 4, 6]), r2).map((v) => v.qty)).toEqual([1, 2, 3, 4])
    expect(fitVariants(cand('CJ제일제당 비비고 왕교자 1.05kg', [1, 2, 3, 4, 6]), fitRule('비비고 왕교자', '1.05kg', 1)).map((v) => v.qty)).toEqual([1, 2])
    expect(fitVariants(cand('예시 볶음밥 3종 세트', [1, 2, 4, 6]), r2).map((v) => v.qty)).toEqual([1, 2])
    expect(fitVariants(cand('CJ제일제당 비비고 왕교자 1.05kg', [6, 8]), r2).map((v) => v.qty)).toEqual([6])
    expect(fitVariants(cand('이천쌀 10kg', [1, 2, 3]), fitRule('쌀', null, 1)).map((v) => v.qty)).toEqual([1, 2])
    expect(fitVariants(cand('깨끗한나라 화장지 30롤', [1, 2, 4]), fitRule('휴지', null, 1)).map((v) => v.qty)).toEqual([1, 2, 4])
  })
  it('splitCandidates: 맞는 것(수량 줄 다듬음)과 큰 용량(줄 그대로)으로 나누고 순서는 지킨다', () => {
    const r1 = fitRule('비비고 왕교자', '1.05kg', 1)
    const list = [cand('CJ제일제당 비비고 왕교자 1.925kg', [1, 2]), cand('CJ제일제당 비비고 왕교자 1.05kg', [1, 2, 3]), cand('업소용 왕교자 1kg', [1])]
    const { fit, bulk } = splitCandidates(list, r1)
    expect(fit.map((c) => [c.name, c.variants.map((v) => v.qty)])).toEqual([['CJ제일제당 비비고 왕교자 1.05kg', [1, 2]]])
    expect(bulk.map((c) => [c.name, c.variants.map((v) => v.qty)])).toEqual([['CJ제일제당 비비고 왕교자 1.925kg', [1, 2]], ['업소용 왕교자 1kg', [1]]])
  })
})
