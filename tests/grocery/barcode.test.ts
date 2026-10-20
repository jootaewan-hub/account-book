// 바코드로 상품 보기(P6)의 순수 부분: 읽은 글자를 소매 바코드(EAN-13·EAN-8, UPC-A는 앞에 0을 붙여 13자리)로 정리하고 검사 숫자를 확인한다.
import { describe, expect, it } from 'vitest'
import { danawaBarcodeUrl, normalizeBarcode, RETAIL_FORMATS } from '../../src/grocery/lib/barcode'

describe('normalizeBarcode', () => {
  it('EAN-13은 검사 숫자가 맞을 때만, 숫자 아닌 글자는 뺀다', () => {
    expect(normalizeBarcode('8801007001234')).toBe('8801007001234') // 검사 숫자 4
    expect(normalizeBarcode(' 8801007-001234 ')).toBe('8801007001234')
    expect(normalizeBarcode('8801007001235')).toBeNull()
  })
  it('UPC-A(12자리)는 앞에 0을 붙여 13자리로', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452')
  })
  it('EAN-8은 8자리 그대로(검사 숫자 확인)', () => {
    expect(normalizeBarcode('96385074')).toBe('96385074')
    expect(normalizeBarcode('96385075')).toBeNull()
  })
  it('UPC-E(8자리)는 UPC-A로 펼친 검사 숫자로도 받는다(리뷰 ③)', () => {
    expect(normalizeBarcode('04252614')).toBe('04252614') // UPC-E 0-425261-4 = UPC-A 042100005264
    expect(normalizeBarcode('04252615')).toBeNull()
  })
  it('길이가 다르거나 비었으면 null', () => {
    expect(normalizeBarcode('')).toBeNull()
    expect(normalizeBarcode('12345')).toBeNull()
    expect(normalizeBarcode('https://example.com/qr')).toBeNull()
  })
})

describe('형식·주소', () => {
  it('소매 바코드 형식만 읽는다', () => {
    expect(RETAIL_FORMATS).toEqual(['ean_13', 'ean_8', 'upc_a', 'upc_e'])
  })
  it('다나와 검색 주소는 바코드 숫자를 검색어로', () => {
    expect(danawaBarcodeUrl('8801007001234')).toBe('https://search.danawa.com/?query=8801007001234')
  })
})
