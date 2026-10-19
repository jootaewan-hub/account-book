import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  KEEP_SGG,
  MARKET_ITEMS,
  MarketApiError,
  marketItem,
  marketPriority,
  marketUrl,
  matchMarket,
  parseMarket,
  parsePrice,
  SEONGNAM_MARKET,
} from '../../supabase/functions/_shared/market'

// 2026-10-19 실제 응답에서 옮긴 행(중도매·다른 지역·친환경·축산 전국 행이 섞여 있다)
const SAMPLE = JSON.parse(readFileSync(new URL('./fixtures/market/perday-sample.json', import.meta.url), 'utf8'))

describe('parseMarket', () => {
  it('소매, 성남·수원·서울·전국 행만 남기고 날짜·가격을 바꾼다', () => {
    const { rows, total, seen } = parseMarket(SAMPLE)
    expect(seen).toBe(11)
    expect(total).toBe(11)
    // 중도매 2행과 친환경(07) 1행은 빠진다
    expect(rows).toHaveLength(8)
    expect(rows.every((r) => KEEP_SGG.has(r.sgg_cd))).toBe(true)
    const onion = rows.find((r) => r.item_cd === '245' && r.mrkt_cd === '0110212')!
    expect(onion).toMatchObject({ exmn_ymd: '2026-10-16', price: 2310, unit: 'kg', unit_sz: '1', grd_cd: '04', sgg_nm: '서울', mrkt_nm: '경동' })
    expect(onion.orgnl_reg_dt).toBe('2026-10-16T15:07:24.000Z')
  })

  it('축산물 전국 행은 시장이 빈 글자이고 원본등록일시가 없다', () => {
    const pork = parseMarket(SAMPLE).rows.find((r) => r.item_cd === '4304')!
    expect(pork).toMatchObject({ sgg_cd: '1000', mrkt_cd: '', mrkt_nm: '', price: 1699, unit: 'g', unit_sz: '100', orgnl_reg_dt: null })
  })

  it('행이 하나면 객체로 와도 읽고, 0건이면 빈 배열', () => {
    const one = { response: { header: { resultCode: '0' }, body: { items: { item: SAMPLE.response.body.items.item[2] }, totalCount: 1 } } }
    expect(parseMarket(one).rows).toHaveLength(1)
    const none = { response: { header: { resultCode: '0', resultMsg: '정상' }, body: { items: { item: [] }, totalCount: 0 } } }
    expect(parseMarket(none)).toEqual({ rows: [], total: 0, seen: 0 })
  })

  it('게이트웨이 오류와 결과 코드 오류는 MarketApiError', () => {
    const gw = { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnReasonCode: '30' } } }
    expect(() => parseMarket(gw)).toThrow(MarketApiError)
    expect(() => parseMarket(gw)).toThrow('30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR')
    expect(() => parseMarket({ response: { header: { resultCode: '-10', resultMsg: '트래픽 초과' } } })).toThrow('-10 트래픽 초과')
    expect(() => parseMarket('<xml/>')).toThrow(MarketApiError)
  })

  it('가격이 양의 정수가 아니거나 날짜 모양이 틀리면 그 행을 버린다', () => {
    const base = SAMPLE.response.body.items.item[2]
    const bad = [
      { ...base, exmn_dd_prc: '' }, { ...base, exmn_dd_prc: '0' }, { ...base, exmn_dd_prc: '12.5' },
      { ...base, exmn_dd_prc: '-' }, { ...base, exmn_ymd: '2026-10-16' }, { ...base, exmn_dd_prc: '1,980' },
    ]
    const { rows } = parseMarket({ response: { header: { resultCode: '0' }, body: { items: { item: bad } } } })
    expect(rows.map((r) => r.price)).toEqual([1980])
  })
})

describe('parsePrice', () => {
  it('쉼표·소수점 0은 받고 나머지는 null', () => {
    expect(parsePrice('2,310')).toBe(2310)
    expect(parsePrice('2310.00')).toBe(2310)
    expect(parsePrice(1980)).toBe(1980)
    expect(parsePrice('2310.5')).toBeNull()
    expect(parsePrice(null)).toBeNull()
    expect(parsePrice('0')).toBeNull()
  })
})

describe('marketPriority', () => {
  it('전국 → 성남 B-유통 → 수원 → 서울', () => {
    expect(marketPriority('1000', '')).toBe(0)
    expect(marketPriority('3112', SEONGNAM_MARKET)).toBe(1)
    expect(marketPriority('3111', '0310001')).toBe(3)
    expect(marketPriority('1101', '0110212')).toBe(4)
    expect(marketPriority('2100', 'x')).toBe(9)
  })
})

describe('matchMarket', () => {
  it.each([
    ['대파', null, '246', '00'],
    ['쪽파', null, '246', '02'],
    ['파', null, '246', '00'],
    ['양파', null, '245', null],
    ['햇 양파', null, '245', null],
    ['삼겹살', '600g', '4304', '27'],
    ['한돈 목살', null, '4304', '68'],
    ['수입 삼겹살', null, '4402', '27'],
    ['한우 등심', null, '4301', '22'],
    ['계란', '30구', '9903', null],
    ['계란', '10구', '9903', '21'],
    ['사과', null, '411', null],
    ['부사', null, '411', '05'],
    ['배', null, '412', null],
    ['애호박', null, '224', '01'],
    ['오이고추', null, '242', '04'],
    ['알배기배추', null, '279', null],
    ['배추', null, '211', null],
    ['고등어', null, '611', null],
    ['무', null, '231', null],
  ])('%s(%s) → %s/%s', (name, spec, item, vrty) => {
    expect(matchMarket(name, spec)).toMatchObject({ item, vrty })
  })

  it('한 글자 키워드는 단어 전체가 같을 때만(배달, 무화과, 굴비)', () => {
    expect(matchMarket('무화과')).toBeNull()
    expect(matchMarket('굴비')).toBeNull()
    expect(matchMarket('닭가슴살')).toBeNull()
    expect(matchMarket('고수')).toBeNull()
  })

  it('사전의 품목 코드는 모두 MARKET_ITEMS에 있다', () => {
    for (const name of ['고구마', '시금치', '팽이', '블루베리', '바지락', '생닭', '동태']) {
      const m = matchMarket(name)
      expect(m, name).not.toBeNull()
      expect(marketItem(m!.item), name).not.toBeNull()
    }
    expect(new Set(MARKET_ITEMS.map((m) => m.item)).size).toBe(MARKET_ITEMS.length)
  })
})

describe('marketUrl', () => {
  it('소매·부류·품목·기간 조건을 넣고 키는 공백을 빼 인코딩한다', () => {
    const u = new URL(marketUrl(' ab+c/= \n', { ctgry: '200', item: '246' }, '2026-10-05', '2026-10-19', 2))
    expect(u.origin + u.pathname).toBe('https://apis.data.go.kr/B552845/perDay/price')
    expect(u.searchParams.get('serviceKey')).toBe('ab+c/=')
    expect(u.searchParams.get('cond[exmn_ymd::GTE]')).toBe('20261005')
    expect(u.searchParams.get('cond[exmn_ymd::LTE]')).toBe('20261019')
    expect(u.searchParams.get('cond[se_cd::EQ]')).toBe('01')
    expect(u.searchParams.get('cond[ctgry_cd::EQ]')).toBe('200')
    expect(u.searchParams.get('cond[item_cd::EQ]')).toBe('246')
    expect(u.searchParams.get('pageNo')).toBe('2')
    expect(u.searchParams.get('numOfRows')).toBe('1000')
  })
})
