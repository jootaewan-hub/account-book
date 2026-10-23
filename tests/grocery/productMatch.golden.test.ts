// 정답표(D-026, 설계 4절): 우리 집 상품 15개를 product_auto에 넣어 정답 보고번호를 자동으로 맞히는지, 다른 상품을 자동 저장하지 않는지 본다.
// 식약처 응답은 2026-10-23 sample 키 실제 응답에서 모은 줄(fixtures/foodsafety/match-rows.json)이고, 아래 가짜 API가 주소의 조건(업체명·이름·식품유형·보고번호,
// 부분 일치·띄어쓰기 그대로)과 범위로 걸러 이름 순으로 준다(운영의 50건 창 대신). 다나와 정보는 상품 페이지 값 그대로(설계 3절).
// 줄 가운데 16개(대상 고추장·쌈장·흑설탕, 농심 올리브짜파게티, 진라면 업소용, 매일유업 광주공장)는 sample 키 하루 한도("샘플키로 더 이상 호출할 수 없습니다", INFO-310)에
// 걸려 다시 받지 못해, 같은 날 앞서 받은 실제 응답에서 옮겼다(원재료는 받아 본 두 고추장만 있다).
// 축산물 원재료(C006)는 모으지 못해 보고번호 조회에 I1310 줄의 이름·업체만 돌려준다. 정답표는 어느 보고번호를 고르는지만 본다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle, type FoodInfoDeps } from '../../supabase/functions/food-info/handle'
import type { ProductFacts } from '../../supabase/functions/_shared/productMatch'

type Row = { svc: string } & Record<string, string>
const ROWS: Row[] = JSON.parse(readFileSync(new URL('./fixtures/foodsafety/match-rows.json', import.meta.url), 'utf8'))

/** 식약처 Open API 흉내: /api/{키}/{목록}/json/{시작}/{끝}/{조건=값&…} */
function fakeFoodSafety(url: string): unknown {
  const m = url.match(/\/api\/[^/]+\/(C002|I1310|C006|C003)\/json\/(\d+)\/(\d+)\/(.*)$/)
  if (!m) return { header: { resultCode: '00' }, body: { items: [] } } // 식품영양성분DB: 정답표 밖(sample 키 없음)
  const [, svc, start, end, query] = m
  const conds = query.split('&').map((p) => p.split('=').map(decodeURIComponent) as [string, string])
  if (svc === 'C006') {
    const no = conds.find(([k]) => k === 'PRDLST_REPORT_NO')?.[1]
    const head = ROWS.find((r) => r.svc === 'I1310' && r.PRDLST_REPORT_NO === no)
    if (!head) return { C006: { RESULT: { CODE: 'INFO-200', MSG: '해당하는 데이터가 없습니다.' } } }
    return { C006: { RESULT: { CODE: 'INFO-000' }, total_count: '1', row: [{ PRDLST_REPORT_NO: no, PRDLST_NM: head.PRDLST_NM, BSSH_NM: head.BSSH_NM, PRDLST_DCNM: head.PRDLST_DCNM, RAWMTRL_NM: '' }] } }
  }
  const hit = ROWS.filter((r) => r.svc === svc && conds.every(([k, v]) => (r[k] ?? '').includes(v)))
    .sort((a, b) => (a.PRDLST_NM < b.PRDLST_NM ? -1 : a.PRDLST_NM > b.PRDLST_NM ? 1 : 0))
  if (hit.length === 0) return { [svc]: { RESULT: { CODE: 'INFO-200', MSG: '해당하는 데이터가 없습니다.' } } }
  return { [svc]: { RESULT: { CODE: 'INFO-000' }, total_count: String(hit.length), row: hit.slice(Number(start) - 1, Number(end)).map(({ svc: _s, ...r }) => r) } }
}

const F = (maker: string, brand: string | null = null, origin: string | null = null, materials: string | null = null): ProductFacts => ({ maker, brand, origin, materials })
/** 품목 이름, 상품명(다나와), 다나와 정보, 정답 보고번호(여럿이면 어느 것이든, 없으면 자동 저장하지 않아야 한다) */
const TABLE: [string, string, ProductFacts, string[]][] = [
  ['고추장', '청정원 순창 100% 현미 태양초 찰고추장 2kg', F('대상', '청정원 순창', '고추양념(중국산), 현미(외국산)', '현미 20.2%, 태양초 11.3%'), ['19850499011151']],
  ['굴소스', '이금기 프리미엄 굴소스 510g', F('이금기', null, '홍콩산', '굴추출물농축액 95%'), []],
  ['된장', '샘표 국산콩 100% 백일된장 900g', F('샘표식품', '샘표', '대두(국내산), 천일염(호주산)'), ['1997044104369']],
  ['미림', '롯데푸드 맛술 미림 500ml', F('롯데푸드'), ['202104880608', '2013001911771']],
  ['버터', '폰테라 앵커 무염 버터 454g', F('폰테라', '앵커'), []],
  ['쌈장', '청정원 순창 양념 듬뿍 쌈장 500g', F('대상', '청정원 순창', '대두(외국산), 밀(미국산, 호주산)'), ['1985049901111']],
  ['알룰로스', '큐원 트루스위트 알룰로스 PLUS 난소화성말토덱스트린 540g', F('삼양사', '큐원 트루스위트'), ['1988024709795']],
  ['우유', '매일유업 매일우유 저지방 1% 900ml', F('매일유업'), ['20090476009391', '19800532002193', '19810262002403', '19850213001213']], // 상하·경산·평택·광주공장
  ['진라면 순한맛', '오뚜기 진라면 순한맛 120g', F('오뚜기'), ['19860309018680']],
  ['짜파게티', '농심 올리브 짜파게티 140g', F('농심'), ['20070149002107', '19860360007203']],
  ['참깨', '오뚜기 옛날 볶음참깨 200g', F('오뚜기', null, '외국산'), ['1993044500621']],
  ['참치액', '한라식품 참치액 900ml', F('한라식품', null, '훈연참치(필리핀산), 정제소금(국내산)'), []],
  ['치즈', '임실치즈농협 벨라유 모짜렐라 슬라이스 치즈 100g', F('임실치즈농협'), []],
  ['파슬리', '엘에스푸드 파슬리 후레이크 10g', F('엘에스푸드'), []],
  ['흑설탕', '청정원 유기농 흑설탕 454g', F('대상', '청정원'), ['19930336060347']],
]

async function run(item: string, productName: string, facts: ProductFacts) {
  const saved: string[] = []
  const d: FoodInfoDeps = {
    foodKey: 'sample',
    dataKey: 'DATAKEY',
    fetchJson: async (url) => fakeFoodSafety(url),
    allowedItem: async () => ({ householdId: 'hh', name: item, spec: null, productName, product: { id: 'p', sourceId: '1', facts } }),
    loadFacts: async () => facts,
    clearAuto: async () => {},
    saveNutrition: async () => {},
    saveIngredients: async (_i, info) => {
      saved.push(info.reportNo)
    },
    now: () => new Date('2026-10-23T03:00:00Z'),
  }
  const body = await (await handle(new Request('https://x', { method: 'POST', body: JSON.stringify({ itemId: '33333333-3333-4333-8333-333333333333', action: 'product_auto' }) }), d)).json()
  return { body, saved }
}

describe('정답표(D-026): 우리 집 상품 15개', () => {
  it.each(TABLE)('%s: %s', async (item, productName, facts, answers) => {
    const { body, saved } = await run(item, productName, facts)
    if (answers.length === 0) {
      expect(saved, '정답이 없는 상품은 자동으로 저장하지 않는다').toEqual([])
      expect(body.reason).not.toBeNull()
    } else {
      expect(saved).toHaveLength(1)
      expect(answers).toContain(saved[0])
    }
  })
})
