// 가격 출처 넓히기(P3, D-013) DB: 몰 주소(shop_links)·확인 기록(shop_checks)·shop_prices(), 참가격 표(tprice_*)·
// 품목 ↔ 참가격 상품 연결(store_links)·자주 가는 매장(household_prefs)·item_store_prices(), sync_lock id 3을 PGlite에서 검증한다.
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite
let hhAB: string
let hhC: string
let product: string

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}
async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  return 'NO_ERROR'
}
const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0]
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null))

const KURLY = 'https://www.kurly.com/goods/5082274'
const LOW = 'https://www.lowchart.com/9519439579-18170724212'
const HOME = 'https://mfront.homeplus.co.kr/item?itemNo=120074651&storeType=HYPER'

async function link(uid: string, hh: string, source: string, sourceId: string, url: string, prod = product) {
  await as(uid, `insert into grocery.shop_links (household_id, product_id, source, source_id, url) values ($1, $2, $3, $4, $5)`, [hh, prod, source, sourceId, url])
}
async function check(source: string, sourceId: string, at: string, ok: boolean, price: number | null = null, extra: Record<string, unknown> = {}) {
  return scalar<string>(
    `insert into grocery.shop_checks (source, source_id, checked_at, ok, error, name, price, obs_low, changed_on, price_from)
     values ($1, $2, ${at}, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [source, sourceId, ok, ok ? null : 'http_503', ok ? '상품' : null, price, extra.obs_low ?? null, extra.changed_on ?? null, extra.price_from ?? null],
  )
}
async function item(hh: string, uid: string, name: string, spec: string | null) {
  return scalar<string>(`insert into grocery.items (household_id, name, spec, category, added_by) values ($1, $2, $3, '냉동', $4) returning id`, [hh, name, spec, uid])
}
async function store(id: string, name: string, area: string, type = 'LM') {
  await db.query(`insert into grocery.tprice_stores (entp_id, name, type_code, area_code, area_detail_code) values ($1, $2, $3, '020900000', $4)`, [id, name, type, area])
}
async function good(id: string, name: string) {
  await db.query(`insert into grocery.tprice_goods (good_id, name, total_cnt, total_div) values ($1, $2, 1, 'kg')`, [id, name])
}
async function price(entp: string, goodId: string, on: string, p: number) {
  await db.query(`insert into grocery.tprice_prices (entp_id, good_id, inspected_on, price) values ($1, $2, $3, $4)`, [entp, goodId, on, p])
}

beforeAll(async () => {
  db = await freshDb([A, B, C], async (d) => {
    hhAB = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    hhC = (await d.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
    await d.query(
      `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
       ($1,$3,'A','owner','husband'), ($1,$4,'B','partner','wife'), ($2,$5,'C','owner','husband')`,
      [hhAB, hhC, A, B, C],
    )
  })
  product = await scalar<string>(`insert into grocery.products (source, source_id, name) values ('danawa', '5643303', '비비고 왕교자 1.05kg') returning id`)
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec(`delete from grocery.shop_links; delete from grocery.shop_checks; delete from grocery.store_links; delete from grocery.household_prefs;
    delete from grocery.tprice_prices; delete from grocery.tprice_goods; delete from grocery.tprice_stores; delete from grocery.items;`)
})

describe('shop_links(가구가 상품에 붙인 몰 주소)', () => {
  it('같은 가구는 보고, 다른 가구와 로그인 안 한 사용자는 못 본다', async () => {
    await link(A, hhAB, 'kurly', '5082274', KURLY)
    expect(await as(B, `select source, source_id, url, added_by from grocery.shop_links`)).toEqual([{ source: 'kurly', source_id: '5082274', url: KURLY, added_by: A }])
    expect(await as(C, `select 1 from grocery.shop_links`)).toEqual([])
    expect(await errorOf(as(null, `select 1 from grocery.shop_links`))).toMatch(/permission denied/)
  })

  it('남의 가구에 넣거나 다른 사람 이름으로 넣으면 거절', async () => {
    expect(await errorOf(link(C, hhAB, 'kurly', '5082274', KURLY))).toMatch(/row-level security/)
    expect(await errorOf(as(B, `insert into grocery.shop_links (household_id, product_id, source, source_id, url, added_by) values ($1, $2, 'kurly', '1', $3, $4)`, [hhAB, product, KURLY, A]))).toMatch(/row-level security/)
  })

  it('주소 모양과 출처는 정해진 것만: 쿠팡 주소·검색 주소·다른 출처는 거절', async () => {
    expect(await errorOf(link(A, hhAB, 'lowchart', '9519439579-18170724212', 'https://www.coupang.com/vp/products/9519439579?itemId=18170724212'))).toMatch(/check constraint/)
    expect(await errorOf(link(A, hhAB, 'kurly', 'x', 'https://www.kurly.com/search?sword=x'))).toMatch(/check constraint/)
    expect(await errorOf(link(A, hhAB, 'cjthemarket', '1', 'https://www.cjthemarket.com/the/product/product-main?prdCd=1'))).toMatch(/check constraint/)
    await link(A, hhAB, 'homeplus', '120074651:HYPER', HOME)
    await link(A, hhAB, 'lowchart', '9519439579-18170724212', LOW)
    expect((await as(A, `select count(*)::int as n from grocery.shop_links`))[0].n).toBe(2)
  })

  it('주소는 출처·출처 id에서 만든 것과 같아야 한다(다른 가구가 같은 출처 id로 보는 값을 오염시키지 못하게)', async () => {
    expect(await errorOf(link(A, hhAB, 'kurly', '1', LOW))).toMatch(/check constraint/)
    expect(await errorOf(link(A, hhAB, 'kurly', '5082274', 'https://www.kurly.com/goods/1000466118'))).toMatch(/check constraint/)
    expect(await errorOf(link(A, hhAB, 'homeplus', '120074651:EXP', HOME))).toMatch(/check constraint/)
    expect(await errorOf(link(A, hhAB, 'lowchart', '9519439579-1', LOW))).toMatch(/check constraint/)
    await link(A, hhAB, 'kurly', '5082274', KURLY)
  })

  it('출처마다 하나: 같은 출처를 다시 넣으면 덮어쓰고(upsert), 뺄 수 있다', async () => {
    await link(A, hhAB, 'kurly', '5082274', KURLY)
    await as(B, `insert into grocery.shop_links (household_id, product_id, source, source_id, url) values ($1, $2, 'kurly', '1000466118', 'https://www.kurly.com/goods/1000466118')
      on conflict (household_id, product_id, source) do update set source_id = excluded.source_id, url = excluded.url, added_by = excluded.added_by, added_at = excluded.added_at`, [hhAB, product])
    expect(await as(A, `select source_id, added_by from grocery.shop_links`)).toEqual([{ source_id: '1000466118', added_by: B }])
    await as(A, `delete from grocery.shop_links where household_id = $1 and product_id = $2 and source = 'kurly'`, [hhAB, product])
    expect(await as(A, `select 1 from grocery.shop_links`)).toEqual([])
  })

  it('데이터 API 모양의 upsert(충돌 열쇠 칸까지 set에 넣음)가 로그인 사용자 권한으로 된다(20261101000000)', async () => {
    // PostgREST merge-duplicates는 보낸 칸 전부를 do update set에 넣는다. 열쇠 칸에 update 권한이 없으면 첫 저장부터 42501이다
    const sql = `insert into grocery.shop_links (household_id, product_id, source, source_id, url, added_by, added_at)
      values ($1, $2, 'kurly', '5082274', $3, $4, now())
      on conflict (household_id, product_id, source) do update set household_id = excluded.household_id, product_id = excluded.product_id,
        source = excluded.source, source_id = excluded.source_id, url = excluded.url, added_by = excluded.added_by, added_at = excluded.added_at`
    await as(A, sql, [hhAB, product, KURLY, A])
    await as(B, sql, [hhAB, product, KURLY, B])
    expect(await as(A, `select added_by from grocery.shop_links`)).toEqual([{ added_by: B }])
    // 다른 가구로 옮기는 것은 정책이 막는다
    expect(await errorOf(as(A, `update grocery.shop_links set household_id = $1`, [hhC]))).toMatch(/row-level security|permission denied/)
  })
})

describe('shop_checks(출처 페이지 확인 기록)', () => {
  it('로그인한 사용자는 읽기만, 쓰기는 서비스 롤만', async () => {
    await check('kurly', '5082274', 'now()', true, 10980)
    expect((await as(A, `select price from grocery.shop_checks`))[0].price).toBe(10980)
    expect(await errorOf(as(A, `insert into grocery.shop_checks (source, source_id, ok) values ('kurly', '1', false)`))).toMatch(/permission denied/)
  })

  it('성공 기록에는 이름과 양의 가격이 꼭 있다', async () => {
    expect(await errorOf(check('kurly', '5082274', 'now()', true, null))).toMatch(/check constraint/)
    expect(await errorOf(check('kurly', '5082274', 'now()', true, 0))).toMatch(/check constraint/)
    await check('kurly', '5082274', 'now()', false)
  })
})

describe('shop_prices(p_product)', () => {
  it('내 가구가 넣은 주소마다 마지막 확인 상태와 마지막 성공 값을 돌려준다', async () => {
    await link(A, hhAB, 'kurly', '5082274', KURLY)
    await link(A, hhAB, 'lowchart', '9519439579-18170724212', LOW)
    await link(C, hhC, 'kurly', '5082274', KURLY)
    await check('kurly', '5082274', `now() - interval '1 day'`, true, 10980)
    await check('kurly', '5082274', `now() - interval '2 hours'`, true, 10500, { obs_low: null, changed_on: null, price_from: '2026-10-19' })
    await check('kurly', '5082274', `now() - interval '1 hour'`, false)
    const rows = await as(B, `select * from grocery.shop_prices($1)`, [product])
    expect(rows.map((r) => r.source)).toEqual(['kurly', 'lowchart'])
    expect(rows[0]).toMatchObject({ source_id: '5082274', url: KURLY, ok: false, error: 'http_503', price: 10500, name: '상품' })
    expect(ymd(rows[0].price_from)).toBe('2026-10-19')
    expect(new Date(rows[0].checked_at as string).getTime()).toBeGreaterThan(new Date(rows[0].priced_at as string).getTime())
    expect(rows[1]).toMatchObject({ source_id: '9519439579-18170724212', url: LOW, ok: null, price: null, priced_at: null })
    expect((await as(C, `select source from grocery.shop_prices($1)`, [product])).length).toBe(1)
    expect(await errorOf(as(null, `select * from grocery.shop_prices($1)`, [product]))).toMatch(/permission denied/)
  })
})

describe('참가격 표', () => {
  it('공개 자료라 로그인한 사용자는 모두 읽고, 쓰기는 서비스 롤만', async () => {
    await store('7', '이마트분당점', '020925000')
    await good('1001', '비비고 왕교자(1.12kg)')
    await price('7', '1001', '2026-10-09', 9980)
    expect((await as(C, `select price from grocery.tprice_prices`))[0].price).toBe(9980)
    expect(await errorOf(as(A, `insert into grocery.tprice_stores (entp_id, name, type_code, area_code, area_detail_code) values ('9', 'x', 'LM', '0', '0')`))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `update grocery.tprice_prices set price = 1`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `select 1 from grocery.tprice_goods`))).toMatch(/permission denied/)
  })

  it('가격은 양수만, 판매점·상품이 있어야 한다', async () => {
    await store('7', '이마트분당점', '020925000')
    await good('1001', '비비고 왕교자(1.12kg)')
    expect(await errorOf(price('7', '1001', '2026-10-09', 0))).toMatch(/check constraint/)
    expect(await errorOf(price('8', '1001', '2026-10-09', 100))).toMatch(/foreign key/)
    expect(await errorOf(price('7', '1002', '2026-10-09', 100))).toMatch(/foreign key/)
  })

  it('수집 잠금 id 3(참가격)·4(가격 다시 확인)가 있다', async () => {
    expect(await scalar<number>(`select count(*)::int from grocery.sync_lock where id in (3, 4) and locked_at = '-infinity'`)).toBe(2)
    expect(await errorOf(db.query(`insert into grocery.sync_lock (id, locked_at) values (5, now())`))).toMatch(/check constraint/)
  })
})

describe('store_links·choose_store_good(품목 ↔ 참가격 상품)', () => {
  it('품목의 이름·규격 열쇠로 기억하고, 같은 이름의 다른 품목도 같은 연결로 본다', async () => {
    await good('1001', '비비고 왕교자(1.12kg)')
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    const it2 = await item(hhAB, B, '비비고 왕교자', '1.05kg')
    const it3 = await item(hhAB, A, '비비고 왕교자', '2kg')
    await as(A, `select grocery.choose_store_good($1, '1001')`, [it1])
    expect(await as(B, `select name_key, good_id, chosen_by from grocery.store_links`)).toEqual([{ name_key: '비비고왕교자|1.05kg', good_id: '1001', chosen_by: A }])
    expect(await as(B, `select good_id, good_name from grocery.item_store_link($1)`, [it2])).toEqual([{ good_id: '1001', good_name: '비비고 왕교자(1.12kg)' }])
    expect(await as(A, `select good_id from grocery.item_store_link($1)`, [it3])).toEqual([])
  })

  it('바꾸기와 풀기(null), 남의 품목은 item_not_found', async () => {
    await good('1001', '비비고 왕교자(1.12kg)')
    await good('1002', '서울우유 흰우유(1L)')
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    await as(A, `select grocery.choose_store_good($1, '1001')`, [it1])
    await as(B, `select grocery.choose_store_good($1, '1002')`, [it1])
    expect(await as(A, `select good_id, chosen_by from grocery.store_links`)).toEqual([{ good_id: '1002', chosen_by: B }])
    expect(await errorOf(as(C, `select grocery.choose_store_good($1, '1001')`, [it1]))).toMatch(/item_not_found/)
    expect(await errorOf(as(A, `select grocery.choose_store_good($1, '9999')`, [it1]))).toMatch(/foreign key/)
    await as(A, `select grocery.choose_store_good($1, null)`, [it1])
    expect(await as(A, `select 1 from grocery.store_links`)).toEqual([])
    expect(await as(C, `select 1 from grocery.store_links`)).toEqual([])
  })
})

describe('household_prefs(자주 가는 매장)', () => {
  it('가구 구성원이 넣고 고치며, 다른 가구는 못 본다. 매장은 10곳까지', async () => {
    await as(A, `insert into grocery.household_prefs (household_id, store_ids) values ($1, '{7,912}')`, [hhAB])
    expect(await as(B, `select store_ids, updated_by from grocery.household_prefs`)).toEqual([{ store_ids: ['7', '912'], updated_by: A }])
    await as(B, `insert into grocery.household_prefs (household_id, store_ids) values ($1, '{82}')
      on conflict (household_id) do update set store_ids = excluded.store_ids, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, [hhAB])
    expect(await as(A, `select store_ids, updated_by from grocery.household_prefs`)).toEqual([{ store_ids: ['82'], updated_by: B }])
    expect(await as(C, `select 1 from grocery.household_prefs`)).toEqual([])
    expect(await errorOf(as(C, `insert into grocery.household_prefs (household_id, store_ids) values ($1, '{1}')`, [hhAB]))).toMatch(/row-level security/)
    expect(await errorOf(as(C, `insert into grocery.household_prefs (household_id, store_ids) values ($1, '{1,2,3,4,5,6,7,8,9,10,11}')`, [hhC]))).toMatch(/check constraint/)
  })
})

describe('item_store_prices(p_item)', () => {
  beforeEach(async () => {
    await store('7', '이마트분당점', '020925000')
    await store('912', '이마트성남점', '020918000')
    await store('82', '농협하나로유통 성남점', '020919000', 'SM')
    await store('1', '이마트 수원점', '020800000')
    await good('1001', '비비고 왕교자(1.12kg)')
    await price('7', '1001', '2026-09-25', 3100)
    await price('7', '1001', '2026-10-09', 2980)
    await price('912', '1001', '2026-10-09', 2900)
    await price('1', '1001', '2026-10-09', 1000)
  })

  it('고른 매장이 없으면 성남 판매점 전부: 매장마다 마지막 조사값, 없는 매장은 null, 싼 순', async () => {
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    await as(A, `select grocery.choose_store_good($1, '1001')`, [it1])
    const rows = await as(B, `select * from grocery.item_store_prices($1)`, [it1])
    expect(rows.map((r) => [r.entp_id, r.entp_name, r.price, ymd(r.inspected_on)])).toEqual([
      ['912', '이마트성남점', 2900, '2026-10-09'],
      ['7', '이마트분당점', 2980, '2026-10-09'],
      ['82', '농협하나로유통 성남점', null, null],
    ])
    expect(rows[0]).toMatchObject({ good_id: '1001', good_name: '비비고 왕교자(1.12kg)', type_code: 'LM', dc: false, plus_one: false })
  })

  it('자주 가는 매장을 골랐으면 그 매장만', async () => {
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    await as(A, `select grocery.choose_store_good($1, '1001')`, [it1])
    await as(A, `insert into grocery.household_prefs (household_id, store_ids) values ($1, '{7}')`, [hhAB])
    expect((await as(A, `select entp_id from grocery.item_store_prices($1)`, [it1])).map((r) => r.entp_id)).toEqual(['7'])
  })

  it('참가격 상품을 고르지 않았거나 남의 품목이면 빈 결과', async () => {
    const it1 = await item(hhAB, A, '비비고 왕교자', '1.05kg')
    expect(await as(A, `select 1 from grocery.item_store_prices($1)`, [it1])).toEqual([])
    await as(A, `select grocery.choose_store_good($1, '1001')`, [it1])
    expect(await as(C, `select 1 from grocery.item_store_prices($1)`, [it1])).toEqual([])
  })
})
