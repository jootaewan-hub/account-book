// 성분·대안(P7): 식약처 C002(원재료)와 식품영양성분DB(15127578) 주소 만들기·응답 읽기, 상품명에서 찾을 말 고르기, 후보 순서.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FoodInfoError, c002Terms, c002Url, isDish, nutritionSearchUrl, nutritionTier, nutritionUrl, parseC002, parseNutrition, parseNutritionRows, productFit, productPhrases, productWords, rankByProduct, rankC002, rankNutrition,
} from '../../supabase/functions/_shared/foodInfo'

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/foodsafety/${f}`, import.meta.url), 'utf8'))

describe('C002 원재료', () => {
  it('주소: https, 키는 경로에, 이름 검색은 PRDLST_NM=, 1~20건', () => {
    expect(c002Url('KEY', '왕교자')).toBe('https://openapi.foodsafetykorea.go.kr/api/KEY/C002/json/1/20/PRDLST_NM=%EC%99%95%EA%B5%90%EC%9E%90')
    expect(c002Url('KEY', '왕교자', 21, 40)).toBe('https://openapi.foodsafetykorea.go.kr/api/KEY/C002/json/21/40/PRDLST_NM=%EC%99%95%EA%B5%90%EC%9E%90')
  })
  it('응답: 품목제조보고번호·이름·업체·원재료·변경일·유형을 읽는다', () => {
    const r = parseC002(read('C002-sample.json'))
    expect(r.total).toBe(1081610) // total_count는 범위와 상관없이 전체 건수(sample 응답 그대로)
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0]).toEqual({
      reportNo: '1997040105528', name: '가시오가피 냉면', maker: '주식회사 금성에프앤비', rawMaterials: '밀가루, 정제수, 타피오카전분, 가시오갈피분말, 알카리제, 정제염',
      kind: '숙면', changedOn: '2023-06-10',
    })
  })
  it('INFO-200(자료 없음)은 빈 결과, 다른 오류 코드는 FoodInfoError', () => {
    expect(parseC002({ C002: { RESULT: { CODE: 'INFO-200', MSG: '해당하는 데이터가 없습니다.' } } })).toEqual({ total: 0, rows: [] })
    expect(() => parseC002({ RESULT: { CODE: 'ERROR-300', MSG: '필수 값이 누락' } })).toThrow(FoodInfoError)
    expect(() => parseC002('<html>')).toThrow(FoodInfoError)
  })
})

describe('찾을 말 고르기·후보 순서', () => {
  it('상품명에서 수량·단위·광고 말을 빼고, 브랜드처럼 보이는 첫 말보다 뒤의 말을 먼저 쓴다', () => {
    expect(c002Terms('CJ제일제당 비비고 왕교자 1.05kg (3개)')).toEqual(['왕교자', '비비고', 'cj제일제당'])
    expect(c002Terms('농심 신라면 120g*5입')).toEqual(['신라면', '농심'])
    expect(c002Terms('')).toEqual([])
  })
  it('후보는 상품명 단어가 많이 맞는 것부터, 같으면 변경일이 늦은 것부터', () => {
    const rows = [
      { reportNo: '1', name: '왕교자 만두피', maker: 'a', rawMaterials: null, kind: null, changedOn: '2024-01-01' },
      { reportNo: '2', name: '비비고 왕교자', maker: 'b', rawMaterials: null, kind: null, changedOn: '2023-01-01' },
      { reportNo: '3', name: '비비고 왕교자', maker: 'c', rawMaterials: null, kind: null, changedOn: '2025-01-01' },
    ]
    expect(rankC002(rows, ['왕교자', '비비고', 'cj제일제당']).map((r) => r.reportNo)).toEqual(['3', '2', '1'])
  })
})

describe('식품영양성분DB', () => {
  it('주소: serviceKey, 품목제조보고번호로, json', () => {
    expect(nutritionUrl('K+K', '1997040105528')).toBe(
      'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03?serviceKey=K%2BK&type=json&pageNo=1&numOfRows=5&ITEM_REPORT_NO=1997040105528',
    )
  })
  it('응답: 기준량과 열량·탄수화물·당류·단백질·지방·포화지방·트랜스지방·콜레스테롤·나트륨, 출처·중량. 없는 값은 null', () => {
    const n = parseNutrition(read('nutrition-sample.json'))
    expect(n).toEqual({
      basis: '100g', kcal: 232, carbs: 27.9, sugars: 2.1, protein: 9.8, fat: 9.2, satFat: 3.1, transFat: 0, cholesterol: 12, sodium: 540,
      weight: 1050, servingRef: 100, source: '식품의약품안전처(식품영양성분DB)', foodName: '왕교자', maker: '씨제이제일제당(주)', updatedOn: '2025-03-01',
    })
    expect(parseNutrition({ header: { resultCode: '00' }, body: { totalCount: 0, items: [] } })).toBeNull()
    expect(() => parseNutrition({ header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } })).toThrow(FoodInfoError)
  })
})

describe('식품영양성분DB 이름 검색(P9, D-018)', () => {
  it('주소: FOOD_NM_KR로 50건(순서를 매긴 뒤 20건만 보여 준다), json', () => {
    expect(nutritionSearchUrl('K+K', '대파')).toBe(
      'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03?serviceKey=K%2BK&type=json&pageNo=1&numOfRows=50&FOOD_NM_KR=%EB%8C%80%ED%8C%8C',
    )
  })
  it('품목대표(일반 식품)만 찾기: DB_CLASS_NM을 붙인다(D-018 보충 2)', () => {
    expect(nutritionSearchUrl('K+K', '우유', 50, '품목대표')).toBe(
      'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03/getFoodNtrCpntDbInq03?serviceKey=K%2BK&type=json&pageNo=1&numOfRows=50&FOOD_NM_KR=%EC%9A%B0%EC%9C%A0&DB_CLASS_NM=%ED%92%88%EB%AA%A9%EB%8C%80%ED%91%9C',
    )
  })
  it('응답 줄마다 식품코드·보고번호를 함께 읽고, 없으면 빈 배열', () => {
    const rows = parseNutritionRows(read('nutrition-sample.json'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ foodCd: 'P000000001', reportNo: '1997040105528', foodName: '왕교자', kcal: 232, basis: '100g', dbClass: '상용제품', category: '즉석식품류', group: '가공식품' })
    expect(parseNutritionRows({ header: { resultCode: '00' }, body: { totalCount: 0, items: [] } })).toEqual([])
  })
})

describe('영양성분 후보 순서(사용자 2026-10-20: "우유"에 관련 없는 것이 너무 많이 나옴)', () => {
  const r = (foodName: string) => ({ foodName })
  it('이름이 같은 것, "우유, …"처럼 이름으로 시작하는 것, 단어로 들어 있는 것, 그냥 포함된 것 순. 같은 단계면 짧은 이름 먼저', () => {
    const rows = [r('우유식빵'), r('우유, 전지, 멸균'), r('바나나 우유'), r('우유'), r('딸기우유(가공유)'), r('우유, 저지방')]
    expect(rankNutrition(rows, '우유').map((x) => x.foodName)).toEqual(['우유', '우유, 저지방', '우유, 전지, 멸균', '바나나 우유', '우유식빵', '딸기우유(가공유)'])
    expect(rankNutrition([r('파김치'), r('파, 대파, 생것')], ' 대파 ').map((x) => x.foodName)).toEqual(['파, 대파, 생것', '파김치'])
    expect(rankNutrition(rows, '').map((x) => x.foodName)).toEqual(rows.map((x) => x.foodName))
  })
})

describe('자동 맞춤 단계(사용자 2026-10-20 12:03: "우유"에 도넛_제주말차 우유 도넛이 맞춰짐, D-018 보충 2)', () => {
  it('"우유_일반"처럼 밑줄 뒤에 세부 이름이 오는 것도 이름으로 시작하는 것(1). 단어로만 든 것(2)과 그냥 포함(3), 무관(4)', () => {
    expect(nutritionTier('우유', '우유')).toBe(0)
    expect(nutritionTier('우유_일반', '우유')).toBe(1)
    expect(nutritionTier('우유, 저지방', '우유')).toBe(1)
    expect(nutritionTier('우유(멸균)', ' 우유 ')).toBe(1)
    expect(nutritionTier('도넛_제주말차 우유 도넛', '우유')).toBe(2)
    expect(nutritionTier('우유식빵', '우유')).toBe(3)
    expect(nutritionTier('왕교자', '우유')).toBe(4)
  })
  it('같은 단계면 품목대표가 상용제품보다 먼저', () => {
    const rows = [{ foodName: '우유_일반', dbClass: '상용제품' }, { foodName: '우유_일반', dbClass: '품목대표' }]
    expect(rankNutrition(rows, '우유').map((r) => r.dbClass)).toEqual(['품목대표', '상용제품'])
  })
})

describe('상품명으로 찾기(사용자 2026-10-20 12:39: 상품을 고른 품목은 그 상품명으로 성분을 찾아 달라, D-018 보충 3)', () => {
  it('상품명 단어: 용량·수량·연도·광고 말을 빼고 상표(첫 단어)와 %는 남긴다', () => {
    expect(productWords('샘표 국산콩 100% 백일된장 900g')).toEqual(['샘표', '국산콩', '100%', '백일된장'])
    expect(productWords('켈로그 크랜베리 아몬드 그래놀라 1.2KG 2개')).toEqual(['켈로그', '크랜베리', '아몬드', '그래놀라'])
    expect(productWords('당진해나루쌀조합 2026 햅쌀 당진해나루 10kg')).toEqual(['당진해나루쌀조합', '햅쌀', '당진해나루'])
    expect(productWords('매일유업 매일우유 저지방 1% 900ml')).toEqual(['매일유업', '매일우유', '저지방', '1%'])
  })
  it('찾을 말: 상표 뒤 단어 전부(숫자 말 제외) → 마지막 두 단어 → 마지막 단어. 단어가 하나면 그대로', () => {
    expect(productPhrases('샘표 국산콩 100% 백일된장 900g')).toEqual(['국산콩 백일된장', '백일된장'])
    expect(productPhrases('매일유업 매일우유 저지방 1% 900ml')).toEqual(['매일우유 저지방', '저지방'])
    expect(productPhrases('청정원 순창 100% 현미 태양초 찰고추장 2kg')).toEqual(['순창 현미 태양초 찰고추장', '태양초 찰고추장', '찰고추장'])
    expect(productPhrases('한라식품 참치액 900ml')).toEqual(['참치액'])
    expect(productPhrases('미림')).toEqual(['미림'])
  })
  it('순서: 상품 단어가 이름에 많이 든 것 → 제조사에 상표가 든 것 → 짧은 이름. 자동으로 쓰려면 단어 2개 이상이거나 단어 1개+제조사 일치', () => {
    const r = (foodName: string, maker: string | null) => ({ foodName, maker })
    const jang = [r('백일된장', '샘표식품(주)영동공장'), r('국산콩백일된장', '샘표식품주식회사')]
    expect(rankByProduct(jang, '샘표 국산콩 100% 백일된장 900g').map((x) => x.foodName)).toEqual(['국산콩백일된장', '백일된장'])
    expect(jang.map((x) => productFit(x, '샘표 국산콩 100% 백일된장 900g'))).toEqual([true, true])
    const milk = [r('매일우유 저지방 2%', '매일유업㈜ 광주공장'), r('매일우유 저지방', '매일유업㈜ 광주공장'), r('매일우유 저지방 1%', '매일유업㈜평택공장')]
    expect(rankByProduct(milk, '매일유업 매일우유 저지방 1% 900ml')[0].foodName).toBe('매일우유 저지방 1%')
    expect(productFit(r('그래놀라', '아무개식품'), '켈로그 크랜베리 아몬드 그래놀라 1.2KG 2개')).toBe(false)
    expect(productFit(r('크랜베리 아몬드 그래놀라', '농심켈로그(주)'), '켈로그 크랜베리 아몬드 그래놀라 1.2KG 2개')).toBe(true)
    expect(productFit(r('미림', '롯데칠성음료(주)'), '롯데푸드 맛술 미림 500ml')).toBe(true)
    expect(productFit(r('미림', '대상(주)'), '롯데푸드 맛술 미림 500ml')).toBe(false)
  })
  it('음식(D 코드 또는 데이터구분 음식)은 일반 품목이라도 재료 이름으로 자동 맞추지 않는다', () => {
    expect(isDish({ foodCd: 'D113-595050000-0001', group: null })).toBe(true)
    expect(isDish({ foodCd: 'X1', group: '음식' })).toBe(true)
    expect(isDish({ foodCd: 'P112-003000900-F001-001', group: '가공식품' })).toBe(false)
    expect(isDish({ foodCd: 'R113-009000000-0000', group: null })).toBe(false)
  })
})
