// 참가격(한국소비자원 생필품 가격 GW, 15158701) 주소 만들기와 XML 읽기. 사본은 tests/grocery/fixtures/tprice(README 참고).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isSeongnam,
  parseTpriceGoods,
  parseTpricePrices,
  parseTpriceStd,
  parseTpriceStores,
  recentFridays,
  SEONGNAM_AREAS,
  TpriceApiError,
  tpriceUrl,
} from '../../supabase/functions/_shared/tprice'

const read = (f: string) => readFileSync(new URL(`./fixtures/tprice/${f}`, import.meta.url), 'utf8')
const KEY = 'abc+def/ghi=='

describe('주소', () => {
  it('판매점·상품·기준정보는 ServiceKey(대문자 S), 가격은 serviceKey와 goodInspectDay(YYYYMMDD)', () => {
    const base = 'https://apis.data.go.kr/B551919/ProductPriceInfoService/'
    expect(tpriceUrl('stores', KEY)).toBe(`${base}getStoreInfoSvc.do?ServiceKey=abc%2Bdef%2Fghi%3D%3D`)
    expect(tpriceUrl('stores', KEY, { entpId: '7' })).toBe(`${base}getStoreInfoSvc.do?ServiceKey=abc%2Bdef%2Fghi%3D%3D&entpId=7`)
    expect(tpriceUrl('goods', KEY)).toBe(`${base}getProductInfoSvc.do?ServiceKey=abc%2Bdef%2Fghi%3D%3D`)
    expect(tpriceUrl('std', KEY, { classCode: 'AR' })).toBe(`${base}getStandardInfoSvc.do?ServiceKey=abc%2Bdef%2Fghi%3D%3D&classCode=AR`)
    expect(tpriceUrl('prices', KEY, { day: '2026-10-09', entpId: '7' })).toBe(
      `${base}getProductPriceInfoSvc?serviceKey=abc%2Bdef%2Fghi%3D%3D&goodInspectDay=20261009&entpId=7`,
    )
    expect(tpriceUrl('prices', KEY, { day: '2026-10-09', goodId: '1001' })).toBe(
      `${base}getProductPriceInfoSvc?serviceKey=abc%2Bdef%2Fghi%3D%3D&goodInspectDay=20261009&goodId=1001`,
    )
  })

  it('이미 인코딩된 키(%가 있음)는 그대로, 앞뒤 공백은 뗀다', () => {
    expect(tpriceUrl('stores', ' abc%2Bdef ')).toContain('ServiceKey=abc%2Bdef')
  })

  it('가격 주소는 entpId나 goodId가 꼭 있어야 한다(없으면 resultCode 05)', () => {
    expect(() => tpriceUrl('prices', KEY, { day: '2026-10-09' })).toThrow()
  })
})

describe('판매점', () => {
  it('entpInfoVO 줄마다 id·이름·업태·지역·상세지역·주소·전화. id가 없는 줄은 뺀다', () => {
    const stores = parseTpriceStores(read('stores.xml'))
    expect(stores).toHaveLength(5)
    expect(stores[0]).toEqual({
      entpId: '7',
      entpName: '이마트분당점',
      entpTypeCode: 'LM',
      entpAreaCode: '020900000',
      areaDetailCode: '020925000',
      roadAddr: '경기도 성남시 분당구 황새울로 & 360번길 2',
      telno: '031-000-0000',
    })
    expect(stores[1]).toMatchObject({ entpId: '912', areaDetailCode: '020918000', roadAddr: '경기도 성남시 수정구 수정로', telno: null })
    expect(stores[2]).toMatchObject({ entpId: '82', entpTypeCode: 'SM', roadAddr: null, telno: null })
  })

  it('성남은 수정·중원·분당 상세코드', () => {
    expect(SEONGNAM_AREAS).toEqual(['020918000', '020919000', '020925000'])
    const stores = parseTpriceStores(read('stores.xml'))
    expect(stores.filter(isSeongnam).map((s) => s.entpId)).toEqual(['7', '912', '82', '1948'])
  })
})

describe('상품', () => {
  it('item 줄마다 id·이름·용량·단위·분류·상세·제조사. 숫자가 아닌 용량은 null', () => {
    const goods = parseTpriceGoods(read('goods.xml'))
    expect(goods).toHaveLength(3)
    expect(goods[0]).toEqual({
      goodId: '1001',
      goodName: '비비고 왕교자(1.12kg)',
      goodTotalCnt: 1.12,
      goodTotalDivCode: 'kg',
      goodBaseCnt: 100,
      goodUnitDivCode: 'g',
      goodSmlclsCode: 'A0301',
      detailMean: '냉동만두',
      productEntpCode: 'CJ',
    })
    // 명세의 오타(datailMean)로 와도 읽는다
    expect(goods[1]).toMatchObject({ goodId: '1002', detailMean: '120g*5개입', productEntpCode: null })
    expect(goods[2]).toMatchObject({ goodId: '1003', goodTotalCnt: null, goodBaseCnt: null, goodUnitDivCode: null, goodSmlclsCode: null })
  })
})

describe('가격', () => {
  it('goodPriceVO 줄: 조사일은 YYYYMMDD나 YYYY-MM-DD 둘 다 YYYY-MM-DD로, 가격은 양의 정수만(0·"-"는 뺀다)', () => {
    const prices = parseTpricePrices(read('prices.xml'))
    expect(prices).toHaveLength(2)
    expect(prices[0]).toEqual({
      goodInspectDay: '2026-10-09',
      entpId: '7',
      goodId: '1001',
      goodPrice: 9980,
      inputAt: '2026-10-15T06:32:07.000Z',
      dc: false,
      plusOne: false,
      dcStart: null,
      dcEnd: null,
    })
    expect(prices[1]).toEqual({
      goodInspectDay: '2026-10-09',
      entpId: '7',
      goodId: '1002',
      goodPrice: 2980,
      inputAt: '2026-10-15T06:32:07.000Z',
      dc: true,
      plusOne: false,
      dcStart: '2026-10-08',
      dcEnd: '2026-10-14',
    })
  })

  it('줄이 없고 resultCode 00이면 빈 배열(그날 조사값이 없음)', () => {
    expect(parseTpricePrices('<response><result/><resultCode>00</resultCode><resultMsg>성공</resultMsg></response>')).toEqual([])
  })
})

describe('기준정보', () => {
  it('stdInfoVO 줄: code·codeName·highCode', () => {
    const xml = `<response><result>
      <iros.openapi.service.vo.stdInfoVO><code>020925000</code><codeName>분당구</codeName><highCode>020900000</highCode></iros.openapi.service.vo.stdInfoVO>
      <iros.openapi.service.vo.stdInfoVO><code>LM</code><codeName>대형마트</codeName></iros.openapi.service.vo.stdInfoVO>
    </result><resultCode>00</resultCode></response>`
    expect(parseTpriceStd(xml)).toEqual([
      { code: '020925000', codeName: '분당구', highCode: '020900000' },
      { code: 'LM', codeName: '대형마트', highCode: null },
    ])
  })
})

describe('오류', () => {
  it('resultCode가 00이 아니면 TpriceApiError(코드와 문구)', () => {
    let err: unknown
    try {
      parseTpricePrices(read('error-05.xml'))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TpriceApiError)
    expect((err as TpriceApiError).code).toBe('05')
    expect((err as TpriceApiError).message).toContain('entpId 혹은 goodId')
  })

  it('게이트웨이 오류(returnReasonCode)는 그 코드와 returnAuthMsg', () => {
    let err: unknown
    try {
      parseTpriceStores(read('gateway-30.xml'))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TpriceApiError)
    expect((err as TpriceApiError).code).toBe('30')
    expect((err as TpriceApiError).message).toContain('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')
  })

  it('XML도 아니고 결과 코드도 없으면 TpriceApiError(unreadable)', () => {
    expect(() => parseTpriceStores('<html>점검 중</html>')).toThrow(TpriceApiError)
    expect(() => parseTpriceStores('')).toThrow(TpriceApiError)
  })
})

describe('최근 금요일', () => {
  it('한국 날짜 기준으로 오늘(포함) 이전의 금요일 5개, 최근 순', () => {
    // 2026-10-19(월) 한국 시간 09:00 = UTC 00:00
    expect(recentFridays(new Date('2026-10-19T00:00:00Z'))).toEqual(['2026-10-16', '2026-10-09', '2026-10-02', '2026-09-25', '2026-09-18'])
    // 금요일 당일(한국 10-16 자정 직후 = UTC 10-15 15:30)
    expect(recentFridays(new Date('2026-10-15T15:30:00Z'), 2)).toEqual(['2026-10-16', '2026-10-09'])
    // 목요일 한국 23:59 = UTC 14:59 → 아직 10-16이 아니다
    expect(recentFridays(new Date('2026-10-15T14:59:00Z'), 2)).toEqual(['2026-10-09', '2026-10-02'])
  })
})
