// 사진으로 상품 찾기·캡처로 가격 넣기(P4, D-009)의 순수 부분: 요청 검사, 모델 응답 다듬기(읽지 못한 값은 null, 숫자는 양의 정수만), 검색어 만들기.
import { describe, expect, it } from 'vitest'
import { checkList, checkPrice, checkProduct, LIST_PROMPT, listText, parsePhotoInput, PRICE_PROMPT, PRODUCT_PROMPT, productQuery } from '../../supabase/functions/grocery-photo/photo'

const img = { media_type: 'image/jpeg', data: 'abc', width: 100, height: 200 }

describe('요청 검사', () => {
  it('job이 product나 price이고 사진 한 장이어야 한다', () => {
    expect(parsePhotoInput({ job: 'product', image: img })).toEqual({ job: 'product', image: { media_type: 'image/jpeg', data: 'abc', width: 100, height: 200 } })
    expect(parsePhotoInput({ job: 'price', image: img })).toMatchObject({ job: 'price' })
    expect(parsePhotoInput({ job: 'list', image: img })).toMatchObject({ job: 'list' })
    expect(typeof parsePhotoInput({ job: 'menu', image: img })).toBe('string')
    expect(typeof parsePhotoInput({ job: 'product' })).toBe('string')
    expect(typeof parsePhotoInput({ job: 'product', image: { ...img, media_type: 'image/gif' } })).toBe('string')
    expect(typeof parsePhotoInput({ job: 'product', image: { ...img, data: 'x'.repeat(8_000_001) } })).toBe('string')
    expect(typeof parsePhotoInput(null)).toBe('string')
  })
})

describe('포장 사진 → 상품', () => {
  it('이름·브랜드·용량을 다듬고(앞뒤 공백, 60자), 비었으면 null', () => {
    expect(checkProduct({ name: '  왕교자 만두 ', brand: '비비고', size: '1.05kg', note: null })).toEqual({ name: '왕교자 만두', brand: '비비고', size: '1.05kg', note: null })
    expect(checkProduct({ name: '', brand: '  ', size: null, note: '뒷면이라 이름이 안 보여요' })).toEqual({ name: null, brand: null, size: null, note: '뒷면이라 이름이 안 보여요' })
    expect(checkProduct({ name: 'x'.repeat(80), brand: null, size: null, note: null }).name).toHaveLength(60)
  })

  it('검색어는 브랜드 + 이름 + 용량(겹치는 말은 한 번만), 아무것도 못 읽었으면 빈 글자', () => {
    expect(productQuery({ name: '왕교자 만두', brand: '비비고', size: '1.05kg', note: null })).toBe('비비고 왕교자 만두 1.05kg')
    expect(productQuery({ name: '비비고 왕교자 1.05kg', brand: '비비고', size: '1.05kg', note: null })).toBe('비비고 왕교자 1.05kg')
    expect(productQuery({ name: null, brand: null, size: null, note: null })).toBe('')
  })
})

describe('캡처 → 가격', () => {
  it('가격·배송비는 양의 정수(0·음수·소수는 버림), 수량은 1~99(없거나 틀리면 1), 글자는 다듬는다', () => {
    expect(checkPrice({ seller: ' 쿠팡 ', name: '비비고 왕교자 1.05kg', price: 10380.4, qty: 2, size: '1.05kg', delivery: 0, note: null })).toEqual({
      seller: '쿠팡', name: '비비고 왕교자 1.05kg', price: 10380, qty: 2, size: '1.05kg', delivery: 0, note: null,
    })
    expect(checkPrice({ seller: null, name: null, price: 0, qty: null, size: null, delivery: -1, note: '가격이 가려져 있어요' })).toEqual({
      seller: null, name: null, price: null, qty: 1, size: null, delivery: null, note: '가격이 가려져 있어요',
    })
    expect(checkPrice({ seller: '11번가', name: 'x', price: -5, qty: 150, size: null, delivery: 2500, note: null })).toMatchObject({ price: null, qty: 1, delivery: 2500 })
    expect(checkPrice({ seller: 'x', name: 'y', price: 12_000_000_000, qty: 1, size: null, delivery: null, note: null }).price).toBeNull()
  })
})

describe('프롬프트', () => {
  it('읽히지 않는 글자는 추측하지 말라고 지시한다', () => {
    expect(PRODUCT_PROMPT).toMatch(/추측/)
    expect(PRICE_PROMPT).toMatch(/추측/)
    expect(PRICE_PROMPT).toMatch(/판매처|쇼핑몰/)
  })
})

describe('사진으로 담기(list)', () => {
  it('이름은 다듬고(60자), 빈 이름·같은 이름은 빼고, 수량은 1~99(없으면 1), 40개까지', () => {
    const r = checkList({
      items: [
        { name: ' 대파 ', spec: null, count: 2 },
        { name: '우유', spec: '1L', count: null },
        { name: '', spec: null, count: 1 },
        { name: '대파', spec: null, count: 1 },
        { name: '계란', spec: '30구', count: 150 },
      ],
      note: null,
    })
    expect(r.items).toEqual([
      { name: '대파', spec: null, count: 2 },
      { name: '우유', spec: '1L', count: 1 },
      { name: '계란', spec: '30구', count: 1 },
    ])
    const many = checkList({ items: Array.from({ length: 50 }, (_, i) => ({ name: `품목${i}`, spec: null, count: 1 })), note: null })
    expect(many.items).toHaveLength(40)
  })

  it('담기 시트에 넣을 글: 한 줄에 하나, "이름 규격 N개"', () => {
    expect(listText([
      { name: '대파', spec: null, count: 2 },
      { name: '우유', spec: '1L', count: 1 },
    ])).toBe('대파 2개\n우유 1L')
  })

  it('프롬프트는 읽히지 않는 글자를 추측하지 말라고 지시한다', () => {
    expect(LIST_PROMPT).toMatch(/추측/)
  })
})
