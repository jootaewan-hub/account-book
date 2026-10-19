import { describe, expect, it } from 'vitest'
import { fitVariants, isBulk, parseSize, referenceSize, splitCandidates } from '../../supabase/functions/_shared/fit'

const cand = (name: string, qtys: number[] = [1]) => ({ name, variants: qtys.map((qty) => ({ qty, price: qty * 1000 })) })

describe('상품 이름에서 크기 읽기 (2~3인 가구 기준 거르기)', () => {
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

describe('기준 크기 (품목 규격 × 개수, 없으면 2~3인 기본 크기 표)', () => {
  it('규격이 있으면 규격 × 개수', () => {
    expect(referenceSize('비비고 왕교자', '1.05kg', 1)).toEqual({ family: 'mass', n: 1050 })
    expect(referenceSize('비비고 왕교자', '1.05kg', 2)).toEqual({ family: 'mass', n: 2100 })
    expect(referenceSize('계란', '30구', 1)).toEqual({ family: 'count', n: 30 })
    expect(referenceSize('우유', '900ml', 1)).toEqual({ family: 'volume', n: 900 })
  })
  it('판매 단위 규격(1/2포기, 1단)은 기준이 없고, 표에 있는 품목은 표 값', () => {
    expect(referenceSize('배추', '1/2포기', 1)).toBeNull()
    expect(referenceSize('대파', '1단', 1)).toBeNull()
    expect(referenceSize('쌀', null, 1)).toEqual({ family: 'mass', n: 10000 })
    expect(referenceSize('생수', null, 1)).toEqual({ family: 'volume', n: 12000 })
    expect(referenceSize('두루마리 휴지', null, 1)).toEqual({ family: 'count', n: 30 })
    expect(referenceSize('이상한 품목', null, 1)).toBeNull()
  })
})

describe('큰 용량·묶음 가르기', () => {
  const ref1 = referenceSize('비비고 왕교자', '1.05kg', 1)
  const ref2 = referenceSize('비비고 왕교자', '1.05kg', 2)
  it('기준의 1.5배를 넘으면 큰 용량, 업소용·대용량·박스 같은 말이 있으면 크기와 상관없이 큰 용량', () => {
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 1.05kg'), ref1)).toBe(false)
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 1.925kg'), ref1)).toBe(true)
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 1.925kg'), ref2)).toBe(false) // 2봉을 담았으면 1.925kg도 맞는 크기
    expect(isBulk(cand('CJ제일제당 비비고 왕교자 1.05kg x 4 + 김치 왕교자 1.05kg x 2'), ref2)).toBe(true)
    expect(isBulk(cand('업소용 왕교자 1kg'), ref1)).toBe(true)
    expect(isBulk(cand('비비고 왕교자 1박스'), ref1)).toBe(true)
  })
  it('기준이 없으면 무게 2kg·부피 2.5L·개수 30을 넘을 때만, 크기를 모르면 거르지 않는다', () => {
    expect(isBulk(cand('백설 설탕 15kg'), null)).toBe(true)
    expect(isBulk(cand('백설 설탕 1kg'), null)).toBe(false)
    expect(isBulk(cand('제주 삼다수 2L x 6'), null)).toBe(true)
    expect(isBulk(cand('제주 삼다수 2L x 6'), referenceSize('생수', null, 1))).toBe(false)
    expect(isBulk(cand('예시 볶음밥 3종 세트'), ref1)).toBe(false)
  })
  it('수량 줄은 기준 안에 드는 것만 남기고, 크기를 모르면 3개까지, 다 걸러지면 가장 적은 줄 하나는 남긴다', () => {
    expect(fitVariants(cand('CJ제일제당 비비고 왕교자 1.05kg', [1, 2, 3, 4, 6]), ref1).map((v) => v.qty)).toEqual([1])
    expect(fitVariants(cand('CJ제일제당 비비고 왕교자 1.05kg', [1, 2, 3, 4, 6]), ref2).map((v) => v.qty)).toEqual([1, 2, 3])
    expect(fitVariants(cand('예시 볶음밥 3종 세트', [1, 2, 4, 6]), ref1).map((v) => v.qty)).toEqual([1, 2])
    expect(fitVariants(cand('CJ제일제당 비비고 왕교자 1.925kg', [2, 4]), ref1).map((v) => v.qty)).toEqual([2])
  })
  it('splitCandidates: 맞는 것(수량 줄 다듬음)과 큰 용량(줄 그대로)으로 나누고 순서는 지킨다', () => {
    const list = [cand('CJ제일제당 비비고 왕교자 1.925kg', [1, 2]), cand('CJ제일제당 비비고 왕교자 1.05kg', [1, 2]), cand('업소용 왕교자 1kg', [1])]
    const { fit, bulk } = splitCandidates(list, ref1)
    expect(fit.map((c) => [c.name, c.variants.map((v) => v.qty)])).toEqual([['CJ제일제당 비비고 왕교자 1.05kg', [1]]])
    expect(bulk.map((c) => [c.name, c.variants.map((v) => v.qty)])).toEqual([['CJ제일제당 비비고 왕교자 1.925kg', [1, 2]], ['업소용 왕교자 1kg', [1]]])
  })
})
