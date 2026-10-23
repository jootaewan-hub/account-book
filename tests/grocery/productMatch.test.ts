// 상품명 → 식약처 품목 맞춤(D-026): 찾을 말 고르기, 업체 일치, 후보 점수. 이름·업체·원재료는 2026-10-23 sample 키 실제 응답과 다나와 상품 페이지 값 그대로다.
import { describe, expect, it } from 'vitest'
import { makerMatches, matchPlan, rankMatches, scoreMatch, type MatchCandidate } from '../../supabase/functions/_shared/productMatch'

const GOCHUJANG = { maker: '대상', brand: '청정원 순창', origin: '고추양념(중국산), 현미(외국산)', materials: '현미 20.2%, 태양초 11.3%' }
const row = (name: string, maker: string, rawMaterials: string | null = null, changedOn: string | null = null): MatchCandidate => ({ name, maker, rawMaterials, changedOn })

describe('matchPlan: 찾을 말', () => {
  it('업체는 다나와 제조사, 찾을 말은 상표·용량·숫자 말을 뺀 낱말을 뒤(핵심어)부터 3개, 원재료 단서는 원산지·원재료명의 이름', () => {
    const p = matchPlan('청정원 순창 100% 현미 태양초 찰고추장 2kg', GOCHUJANG)
    expect(p.makers).toEqual(['대상'])
    expect(p.words).toEqual(['찰고추장', '태양초', '현미'])
    expect(p.cues).toEqual(['고추양념', '현미', '태양초'])
  })
  it('3자 이상 업체는 앞 2자도 둔다(롯데푸드 미림의 보고 업체는 롯데칠성음료), 다나와 상표 낱말은 찾을 말에서 뺀다', () => {
    expect(matchPlan('롯데푸드 맛술 미림 500ml', { maker: '롯데푸드', brand: null, origin: null, materials: null })).toMatchObject({ makers: ['롯데푸드', '롯데'], words: ['미림', '맛술'] })
    expect(matchPlan('큐원 트루스위트 알룰로스 PLUS 난소화성말토덱스트린 540g', { maker: '삼양사', brand: '큐원 트루스위트', origin: null, materials: null }).words)
      .toEqual(['난소화성말토덱스트린', '알룰로스', 'PLUS']) // 한글 낱말을 먼저, 영문은 뒤로(대소문자 그대로)
    expect(matchPlan('매일유업 매일우유 저지방 1% 900ml', { maker: '매일유업', brand: null, origin: null, materials: null }).words).toEqual(['저지방', '매일우유'])
  })
  it('다나와 제조사를 모르면 상품명 첫 낱말을 업체로 쓴다(지금까지와 같다). 낱말이 하나뿐이면 업체 없이 그 낱말', () => {
    expect(matchPlan('샘표 국산콩 100% 백일된장 900g', null)).toMatchObject({ makers: ['샘표'], words: ['백일된장', '국산콩'] })
    expect(matchPlan('참치액', null)).toMatchObject({ makers: [], words: ['참치액'] })
  })
  it('원산지가 나라 이름뿐이면 원재료 단서가 없다', () => {
    expect(matchPlan('이금기 프리미엄 굴소스 510g', { maker: '이금기', brand: null, origin: '홍콩산', materials: null }).cues).toEqual([])
  })
})

describe('makerMatches: 업체 일치', () => {
  it('법인 표기를 빼고 업체 열쇠로 시작하면 같은 업체(공장 이름이 붙어도)', () => {
    expect(makerMatches('대상(주)오산공장', ['대상'])).toBe(true)
    expect(makerMatches('(주)삼양사울산2공장', ['삼양사', '삼양'])).toBe(true)
    expect(makerMatches('롯데칠성음료(주)군산공장', ['롯데푸드', '롯데'])).toBe(true)
    expect(makerMatches('주식회사 순창우리식품', ['대상'])).toBe(false)
    expect(makerMatches('현대상회', ['대상'])).toBe(false) // 업체명 조건은 부분 일치라 함께 오지만 다른 업체
    expect(makerMatches(null, ['대상'])).toBe(false)
    expect(makerMatches('대상(주)', [])).toBe(false)
  })
})

describe('scoreMatch·rankMatches: 후보 점수', () => {
  it('후보 이름이 상품 낱말로 다 설명되면 cover 1, 상품 낱말이 후보에 든 비율이 recall', () => {
    const p = matchPlan('오뚜기 진라면 순한맛 120g', { maker: '오뚜기', brand: null, origin: null, materials: null })
    expect(scoreMatch(row('오뚜기 진라면 순한맛', '오뚜기라면(주)'), p)).toMatchObject({ makerOk: true, cover: 1, recall: 1 })
    const curry = scoreMatch(row('그대로카레순한맛', '(주)오뚜기'), p)
    expect(curry.makerOk).toBe(true)
    expect(curry.cover).toBeLessThan(0.5)
  })
  it('같은 이름(띄어쓰기만 다름)이면 다나와 원산지·원재료명에 적힌 원재료가 든 쪽이 먼저(고추장 19850499011151)', () => {
    const p = matchPlan('청정원 순창 100% 현미 태양초 찰고추장 2kg', GOCHUJANG)
    const ranked = rankMatches([
      row('청정원 순창 태양초 찰고추장', '대상(주)', '찹쌀, 고춧가루, 밀가루, 혼합양념, 밀쌀, 고추장용메주'),
      row('청정원 순창 태양초 찰고추장 골드', '대상(주)', '찹쌀, 고춧가루'),
      row('청정원순창태양초찰고추장', '대상(주)', '고추양념, 물엿, 현미, 정제수, 천일염, 주정, 고추장용메주, 찰현미'),
      row('기픈샘순창태양초찰고추장', '(주)기픈샘', '고추양념, 현미'),
    ], p)
    expect(ranked.map((s) => s.row.name)).toEqual(['청정원순창태양초찰고추장', '청정원 순창 태양초 찰고추장', '청정원 순창 태양초 찰고추장 골드', '기픈샘순창태양초찰고추장'])
    expect(ranked[0].cueHits).toBe(2)
  })
  it('상품 낱말을 더 많이 담은 것이 먼저: 국산콩백일된장 > 백일된장 > 2년숙성백일된장, 매일우유 저지방 1% > 매일우유 저지방', () => {
    const d = matchPlan('샘표 국산콩 100% 백일된장 900g', { maker: '샘표식품', brand: '샘표', origin: '대두(국내산), 천일염(호주산)', materials: null })
    expect(rankMatches([row('2년숙성백일된장', '샘표식품(주)영동공장'), row('백일된장', '샘표식품(주)영동공장'), row('국산콩백일된장', '샘표식품(주)영동공장')], d).map((s) => s.row.name))
      .toEqual(['국산콩백일된장', '백일된장', '2년숙성백일된장'])
    const m = matchPlan('매일유업 매일우유 저지방 1% 900ml', { maker: '매일유업', brand: null, origin: null, materials: null })
    expect(rankMatches([row('매일우유 저지방', '매일유업(주) 광주공장'), row('매일우유 저지방 1%', '매일유업(주)상하공장')], m)[0].row.name).toBe('매일우유 저지방 1%')
  })
  it('점수가 같으면 변경일이 늦은 것(같은 이름으로 다시 보고한 맛술 미림)', () => {
    const p = matchPlan('롯데푸드 맛술 미림 500ml', { maker: '롯데푸드', brand: null, origin: null, materials: null })
    const ranked = rankMatches([row('맛술 미림', '롯데칠성음료㈜군산공장', null, '2019-01-02'), row('맛술미림 13.9%', '롯데칠성음료(주)군산공장'), row('맛술 미림', '롯데칠성음료(주)군산공장', null, '2024-05-01')], p)
    expect(ranked.map((s) => [s.row.name, s.row.changedOn])).toEqual([['맛술 미림', '2024-05-01'], ['맛술 미림', '2019-01-02'], ['맛술미림 13.9%', null]])
  })
})
