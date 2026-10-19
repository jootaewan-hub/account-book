// 농수산물 시세 DB(price_points, watch, market_board, market_trend)를 PGlite에서 검증한다(D-012).
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { marketPriority } from '../../supabase/functions/_shared/market'
import { freshDb } from './dbSetup'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite
let hhAB: string
let hhC: string

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

// 오늘(한국 날짜)에서 n일 전 YYYY-MM-DD
const kstToday = new Date(Date.now() + 9 * 3600_000)
const day = (n: number) => new Date(kstToday.getTime() - n * 86400_000).toISOString().slice(0, 10)

type P = { item?: string; vrty?: string; grd?: string; sgg: string; mrkt: string; on: string; price: number; unit?: string; sz?: string }
const NAMES: Record<string, string> = { '3112': '성남', '3111': '수원', '1101': '서울', '1000': '전국' }
async function point(p: P) {
  await db.query(
    `insert into grocery.price_points (item_cd, vrty_cd, grd_cd, sgg_cd, mrkt_cd, exmn_ymd, ctgry_cd, item_nm, vrty_nm, grd_nm,
       sgg_nm, mrkt_nm, unit, unit_sz, price)
     values ($1,$2,$3,$4,$5,$6,'200','파','대파','상품',$7,$8,$9,$10,$11)`,
    [p.item ?? '246', p.vrty ?? '00', p.grd ?? '04', p.sgg, p.mrkt, p.on, NAMES[p.sgg], p.mrkt ? `시장${p.mrkt}` : '', p.unit ?? 'kg', p.sz ?? '1', p.price],
  )
}

type Board = {
  item_cd: string; vrty_cd: string; grd_cd: string; sgg_cd: string; mrkt_cd: string; cur_on: string; cur_price: number
  prev_on: string | null; prev_price: number | null; w1_on: string | null; w1_price: number | null
  m1_on: string | null; m1_price: number | null; y1_on: string | null; y1_price: number | null
  low: number | null; high: number | null; markets: number | null; first_on: string; days: number
}
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null))
async function board(uid = A): Promise<Board[]> {
  const rows = await as<Record<string, unknown>>(uid, `select * from grocery.market_board()`)
  return rows.map((r) => ({
    ...r,
    cur_on: ymd(r.cur_on), prev_on: ymd(r.prev_on), w1_on: ymd(r.w1_on), m1_on: ymd(r.m1_on), y1_on: ymd(r.y1_on), first_on: ymd(r.first_on),
  })) as Board[]
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
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec('delete from grocery.price_points; delete from grocery.watch;')
})

describe('market_board', () => {
  it('성남 B-유통 값이 있으면 그 값, 범위는 그날 성남·수원·서울 조사처', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(3), price: 1980 })
    await point({ sgg: '3111', mrkt: '0310001', on: day(3), price: 2500 })
    await point({ sgg: '1101', mrkt: '0110212', on: day(3), price: 2660 })
    await point({ sgg: '1101', mrkt: '0110408', on: day(3), price: 4780 })
    await point({ sgg: '1101', mrkt: '0110408', on: day(4), price: 100 }) // 다른 날은 범위에 안 들어간다
    const [b] = await board()
    expect(b).toMatchObject({ sgg_cd: '3112', mrkt_cd: '0310407', cur_on: day(3), cur_price: 1980, low: 1980, high: 4780, markets: 4 })
  })

  it('성남이 최근 14일 안에 없으면 수원, 그것도 없으면 서울 조사처(시장코드 순)', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(30), price: 1500 })
    await point({ sgg: '3111', mrkt: '0310402', on: day(2), price: 2100 })
    await point({ sgg: '3111', mrkt: '0310001', on: day(2), price: 2200 })
    await point({ sgg: '1101', mrkt: '0110212', on: day(2), price: 2600 })
    expect((await board())[0]).toMatchObject({ sgg_cd: '3111', mrkt_cd: '0310001', cur_price: 2200 })
    await db.exec(`delete from grocery.price_points where sgg_cd = '3111'`)
    expect((await board())[0]).toMatchObject({ sgg_cd: '1101', mrkt_cd: '0110212', cur_price: 2600 })
  })

  it('성남이 마지막 날만 빠졌으면 성남의 그 앞 값을 쓴다(조사처가 날마다 바뀌지 않게)', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(4), price: 1980 })
    await point({ sgg: '1101', mrkt: '0110212', on: day(3), price: 2600 })
    expect((await board())[0]).toMatchObject({ sgg_cd: '3112', cur_on: day(4), cur_price: 1980 })
  })

  it('비교 값: 바로 앞 조사일, 7~21일 전, 30~45일 전, 365~379일 전 중 가장 늦은 날(같은 조사처)', async () => {
    const S = { sgg: '3112', mrkt: '0310407' }
    await point({ ...S, on: day(1), price: 2000 })
    await point({ ...S, on: day(2), price: 2100 })
    await point({ ...S, on: day(9), price: 2200 }) // 8일 전(1일 기준)
    await point({ ...S, on: day(12), price: 2300 })
    await point({ ...S, on: day(40), price: 2400 }) // 39일 전
    await point({ ...S, on: day(370), price: 1800 }) // 369일 전
    await point({ sgg: '1101', mrkt: '0110212', on: day(5), price: 9999 }) // 다른 조사처는 비교에 안 쓴다
    const [b] = await board()
    expect(b).toMatchObject({
      cur_on: day(1), cur_price: 2000, prev_on: day(2), prev_price: 2100, w1_on: day(9), w1_price: 2200,
      m1_on: day(40), m1_price: 2400, y1_on: day(370), y1_price: 1800, first_on: day(370), days: 5, // 45일 안: 1·2·9·12·40일 전
    })
  })

  it('비교할 날이 범위 밖이면 null', async () => {
    const S = { sgg: '3112', mrkt: '0310407' }
    await point({ ...S, on: day(1), price: 2000 })
    await point({ ...S, on: day(3), price: 2100 }) // 2일 전: 이전 조사일이지만 1주 전은 아니다
    await point({ ...S, on: day(25), price: 2200 }) // 24일 전: 1주(7~21)도 1개월(30~45)도 아니다
    const [b] = await board()
    expect(b).toMatchObject({ prev_price: 2100, w1_on: null, w1_price: null, m1_price: null, y1_price: null })
  })

  it('단위가 다른 값은 비교·범위에 넣지 않는다', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(1), price: 2000 })
    await point({ sgg: '3112', mrkt: '0310407', on: day(9), price: 30000, unit: 'kg', sz: '10' })
    await point({ sgg: '1101', mrkt: '0110212', on: day(1), price: 20000, unit: 'kg', sz: '10' })
    const [b] = await board()
    expect(b).toMatchObject({ w1_price: null, low: 2000, high: 2000, markets: 1 })
  })

  it('축산물 전국 값은 그 값 하나, 범위는 비어 있다', async () => {
    await point({ item: '4304', vrty: '27', grd: '27', sgg: '1000', mrkt: '', on: day(1), price: 2580, unit: 'g', sz: '100' })
    const [b] = await board()
    expect(b).toMatchObject({ item_cd: '4304', sgg_cd: '1000', mrkt_cd: '', cur_price: 2580, low: null, high: null, markets: 0 })
  })

  it('60일 넘게 값이 없는 품목은 나오지 않고, 품종·등급마다 따로 나온다', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(70), price: 2000 })
    await point({ vrty: '02', sgg: '3112', mrkt: '0310407', on: day(1), price: 3960 })
    await point({ vrty: '02', grd: '05', sgg: '3112', mrkt: '0310407', on: day(1), price: 3000 })
    const rows = await board()
    expect(rows.map((r) => `${r.vrty_cd}/${r.grd_cd}`)).toEqual(['02/04', '02/05'])
  })
})

describe('market_trend', () => {
  it('그 조사처의 최근 45일 값과 날마다 범위', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(1), price: 2000 })
    await point({ sgg: '1101', mrkt: '0110212', on: day(1), price: 2600 })
    await point({ sgg: '1101', mrkt: '0110212', on: day(2), price: 2500 }) // 성남 값이 없는 날도 범위는 나온다
    await point({ sgg: '3112', mrkt: '0310407', on: day(60), price: 1000 }) // 45일 밖
    const rows = await as<{ exmn_ymd: unknown; price: number | null; low: number; high: number; markets: number }>(
      A, `select * from grocery.market_trend('246','00','04','3112','0310407')`)
    expect(rows.map((r) => [ymd(r.exmn_ymd), r.price, r.low, r.high, r.markets])).toEqual([
      [day(2), null, 2500, 2500, 1],
      [day(1), 2000, 2000, 2600, 2],
    ])
  })
})

describe('market_covered', () => {
  it('기간 안에 값이 있는 품목만, 서비스 롤만 부른다', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(3), price: 2000 })
    await point({ item: '245', sgg: '3112', mrkt: '0310407', on: day(30), price: 2000 })
    await db.exec('set role service_role')
    const r = await db.query<{ item_cd: string }>(`select * from grocery.market_covered(array['246','245','411'], $1, $2)`, [day(15), day(0)])
    await db.exec('reset role')
    expect(r.rows.map((x) => x.item_cd)).toEqual(['246'])
    expect(await errorOf(as(A, `select * from grocery.market_covered(array['246'], '2026-01-01', '2026-12-31')`))).toMatch(/permission denied/)
  })
})

describe('market_priority', () => {
  it('SQL과 market.ts가 같은 순서', async () => {
    const cases: [string, string][] = [['1000', ''], ['3112', '0310407'], ['3112', '0310999'], ['3111', '0310001'], ['1101', '0110212'], ['2100', '0210000']]
    for (const [s, m] of cases) {
      const r = await db.query<{ p: number }>(`select grocery.market_priority($1, $2) as p`, [s, m])
      expect(r.rows[0].p, `${s}/${m}`).toBe(marketPriority(s, m))
    }
  })
})

describe('권한', () => {
  it('로그인한 사용자는 조사값을 읽지만 쓰지 못하고, 로그인 안 한 사용자는 읽지도 못한다', async () => {
    await point({ sgg: '3112', mrkt: '0310407', on: day(1), price: 2000 })
    expect(await as(C, `select price from grocery.price_points`)).toHaveLength(1)
    expect(await errorOf(as(A, `insert into grocery.price_points (item_cd, vrty_cd, grd_cd, sgg_cd, mrkt_cd, exmn_ymd, ctgry_cd,
      item_nm, vrty_nm, grd_nm, sgg_nm, mrkt_nm, unit, unit_sz, price) values ('246','00','04','3112','x','2026-10-01','200','a','b','c','d','e','kg','1',1)`)))
      .toMatch(/permission denied/)
    expect(await errorOf(as(null, `select * from grocery.price_points`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `select * from grocery.market_board()`))).toMatch(/permission denied/)
  })

  it('지켜보기는 같은 가구만 보고, 다른 가구 것은 넣거나 지우지 못한다', async () => {
    await as(A, `insert into grocery.watch (household_id, item_cd, vrty_cd, grd_cd) values ($1, '246', '00', '04')`, [hhAB])
    expect(await as(B, `select item_cd, created_by from grocery.watch`)).toEqual([{ item_cd: '246', created_by: A }])
    expect(await as(C, `select * from grocery.watch`)).toEqual([])
    expect(await errorOf(as(C, `insert into grocery.watch (household_id, item_cd, vrty_cd, grd_cd) values ($1, '245', '00', '04')`, [hhAB])))
      .toMatch(/row-level security/)
    expect(await errorOf(as(A, `insert into grocery.watch (household_id, item_cd, vrty_cd, grd_cd, created_by) values ($1, '245', '00', '04', $2)`, [hhAB, B])))
      .toMatch(/row-level security/)
    await as(C, `delete from grocery.watch`)
    expect(await as(A, `select item_cd from grocery.watch`)).toHaveLength(1)
    await as(B, `delete from grocery.watch where item_cd = '246'`)
    expect(await as(A, `select item_cd from grocery.watch`)).toHaveLength(0)
    expect(await errorOf(as(null, `select * from grocery.watch`))).toMatch(/permission denied/)
  })

  it('시세 잠금 행(2)이 있고 식약처 잠금(1)은 그대로', async () => {
    const r = await db.query<{ id: number }>(`select id from grocery.sync_lock order by id`)
    expect(r.rows.map((x) => x.id)).toEqual([1, 2])
    expect(await errorOf(db.query(`insert into grocery.sync_lock (id, locked_at) values (3, now())`))).toMatch(/sync_lock_id_check/)
  })
})
