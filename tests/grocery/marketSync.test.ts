import { describe, expect, it } from 'vitest'
import { MARKET_ITEMS, type MarketRow } from '../../supabase/functions/_shared/market'
import { handle, kstDate, type MarketSyncDeps } from '../../supabase/functions/market-sync/handle'

type Run = Parameters<MarketSyncDeps['recordRun']>[0]

const NOW = new Date('2026-10-19T22:10:00Z') // 한국 시간 10월 20일 07:10
const KEY = 'abc123SECRET'
const post = () => new Request('https://x/functions/v1/market-sync', { method: 'POST' })

const NATIONAL = MARKET_ITEMS.filter((m) => m.ctgry === '500').length
const REGIONAL = MARKET_ITEMS.length - NATIONAL
/** 품목·시군구마다 한 번씩(축산물은 시군구 조건 없이 한 번) */
const PER_WINDOW = REGIONAL * 3 + NATIONAL

/** 가짜 API: 부른 주소를 모으고, 시군구·조사 시작일로 행 하나(또는 total만큼)를 돌려준다 */
function api(opts: { total?: (u: URL) => number; error?: (u: URL) => unknown; throwOn?: (u: URL) => boolean } = {}) {
  const urls: URL[] = []
  const fetchJson = async (url: string) => {
    const u = new URL(url)
    urls.push(u)
    if (opts.throwOn?.(u)) throw new TypeError('fetch failed')
    const err = opts.error?.(u)
    if (err) return err
    const sgg = u.searchParams.get('cond[sgg_cd::EQ]')
    const page = Number(u.searchParams.get('pageNo'))
    const total = opts.total?.(u) ?? 1
    const n = Math.max(0, Math.min(1000, total - (page - 1) * 1000))
    const from = u.searchParams.get('cond[exmn_ymd::GTE]')!
    const item = Array.from({ length: n }, (_, i) => ({
      se_cd: '01', sgg_cd: sgg ?? '1000', sgg_nm: 'x', mrkt_cd: sgg ? `M${sgg}` : null, mrkt_nm: sgg ? 'm' : null,
      exmn_ymd: from, item_cd: u.searchParams.get('cond[item_cd::EQ]'), item_nm: 'n', ctgry_cd: u.searchParams.get('cond[ctgry_cd::EQ]'),
      vrty_cd: '00', vrty_nm: 'v', grd_cd: String((page - 1) * 1000 + i), grd_nm: 'g', unit: 'kg', unit_sz: '1', exmn_dd_prc: '1000',
    }))
    return { response: { header: { resultCode: '0', resultMsg: '정상' }, body: { items: { item }, totalCount: total } } }
  }
  return { urls, fetchJson }
}

function deps(over: Partial<MarketSyncDeps> = {}, a = api()) {
  const upserts: MarketRow[][] = []
  const runs: Run[] = []
  const covered: [string, string][] = []
  const d: MarketSyncDeps = {
    apiKey: ` ${KEY}\n`,
    fetchJson: a.fetchJson,
    now: () => NOW,
    recentOk: async () => false,
    acquire: async () => true,
    covered: async (_items, from, to) => {
      covered.push([from, to])
      return new Set()
    },
    upsert: async (rows) => { upserts.push(rows) },
    recordRun: async (r) => { runs.push(r) },
    ...over,
  }
  return { d, upserts, runs, covered, urls: a.urls }
}

describe('market-sync: 스스로 막기', () => {
  it('POST가 아니면 405, 키가 없거나 공백뿐이면 500', async () => {
    expect((await handle(new Request('https://x', { method: 'GET' }), deps().d)).status).toBe(405)
    expect((await handle(post(), deps({ apiKey: '  ' }).d)).status).toBe(500)
  })

  it('20시간 안에 성공했으면 받지 않는다', async () => {
    let since = ''
    const { d, urls, runs } = deps({ recentOk: async (s) => { since = s; return true } })
    const res = await handle(post(), d)
    expect(await res.json()).toEqual({ status: 'skipped' })
    expect(since).toBe(new Date(NOW.getTime() - 20 * 3600_000).toISOString())
    expect(urls).toHaveLength(0)
    expect(runs).toHaveLength(0)
  })

  it('잠금을 못 얻으면 429, 잠금은 30분 전 기준', async () => {
    const calls: string[][] = []
    const { d, urls } = deps({ acquire: async (c, at) => { calls.push([c, at]); return false } })
    expect((await handle(post(), d)).status).toBe(429)
    expect(calls).toEqual([[new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW.toISOString()]])
    expect(urls).toHaveLength(0)
  })
})

describe('market-sync: 받는 범위', () => {
  it('처음: 품목·시군구마다 45일과 1년 전(379~358일 전)을 받는다. 축산물은 시군구 조건 없이', async () => {
    const { d, urls, runs, upserts, covered } = deps()
    const res = await handle(post(), d)
    expect(res.status).toBe(200)
    expect(covered).toEqual([[kstDate(NOW, 15), kstDate(NOW, 0)], [kstDate(NOW, 379), kstDate(NOW, 358)]])
    expect(urls).toHaveLength(PER_WINDOW * 2)
    const onion = urls.filter((u) => u.searchParams.get('cond[item_cd::EQ]') === '245')
    expect(onion.map((u) => u.searchParams.get('cond[sgg_cd::EQ]')).sort()).toEqual(['1101', '1101', '3111', '3111', '3112', '3112'])
    expect(onion.map((u) => u.searchParams.get('cond[exmn_ymd::GTE]'))).toContain(kstDate(NOW, 45).replaceAll('-', ''))
    expect(onion.every((u) => u.searchParams.get('cond[se_cd::EQ]') === '01')).toBe(true)
    expect(onion.every((u) => u.searchParams.get('serviceKey') === KEY)).toBe(true) // 앞뒤 공백을 뺀 키
    const pork = urls.filter((u) => u.searchParams.get('cond[item_cd::EQ]') === '4304')
    expect(pork).toHaveLength(2)
    expect(pork.every((u) => !u.searchParams.has('cond[sgg_cd::EQ]'))).toBe(true)
    expect(upserts.flat()).toHaveLength(PER_WINDOW * 2)
    expect(runs).toEqual([{ source: 'kamis', ok: true, rows: PER_WINDOW * 2, total: PER_WINDOW * 2, error: null }])
  })

  it('최근 값이 있으면 10일만, 1년 전 값이 있으면 1년 전은 받지 않는다', async () => {
    const all = new Set(MARKET_ITEMS.map((m) => m.item))
    const { d, urls } = deps({ covered: async () => all })
    await handle(post(), d)
    expect(urls).toHaveLength(PER_WINDOW)
    expect(new Set(urls.map((u) => u.searchParams.get('cond[exmn_ymd::GTE]')))).toEqual(new Set([kstDate(NOW, 10).replaceAll('-', '')]))
  })

  it('전체 건수가 한 쪽(1000)을 넘으면 다음 쪽을 받고, 같은 행은 한 번만 저장한다', async () => {
    const one = new Set(MARKET_ITEMS.map((m) => m.item))
    const a = api({ total: (u) => (u.searchParams.get('cond[item_cd::EQ]') === '411' && u.searchParams.get('cond[sgg_cd::EQ]') === '1101' ? 1500 : 1) })
    const { d, urls, upserts } = deps({ covered: async () => one }, a)
    await handle(post(), d)
    const apple = urls.filter((u) => u.searchParams.get('cond[item_cd::EQ]') === '411' && u.searchParams.get('cond[sgg_cd::EQ]') === '1101')
    expect(apple.map((u) => u.searchParams.get('pageNo'))).toEqual(['1', '2'])
    const rows = upserts.flat().filter((r) => r.item_cd === '411' && r.sgg_cd === '1101')
    expect(rows).toHaveLength(1500)
    expect(Math.max(...upserts.map((u) => u.length))).toBeLessThanOrEqual(500)
  })
})

describe('market-sync: 실패', () => {
  it('인증키 오류는 키를 가린 문구로 기록하고 207', async () => {
    const a = api({ error: () => ({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: `KEY ${KEY} IS_NOT_REGISTERED`, returnReasonCode: '30' } } }) })
    const { d, runs } = deps({}, a)
    const res = await handle(post(), d)
    expect(res.status).toBe(207)
    expect(runs[0].ok).toBe(false)
    expect(runs[0].error).toContain('30 KEY *** IS_NOT_REGISTERED')
    expect(runs[0].error).not.toContain(KEY)
  })

  it('트래픽 초과(-10)면 남은 일을 하지 않고 미룬다', async () => {
    const a = api({ error: () => ({ response: { header: { resultCode: '-10', resultMsg: '트래픽 초과' } } }) })
    const { d, urls, runs } = deps({ concurrency: 1 }, a)
    await handle(post(), d)
    expect(urls).toHaveLength(1)
    expect(runs[0].error).toBe(`-10 트래픽 초과 ×1, 미룸 ${PER_WINDOW * 2 - 1}건`)
  })

  it('100초가 지나면 남은 일은 다음 실행으로 미룬다', async () => {
    let t = 0
    const a = api()
    const { d, urls, runs } = deps({ concurrency: 1, clock: () => t, fetchJson: async (u) => { t += 30_000; return a.fetchJson(u) } }, a)
    const res = await handle(post(), d)
    expect(res.status).toBe(207)
    expect(urls).toHaveLength(4) // 0·30·60·90초에 시작, 120초에는 시작하지 않는다
    expect(runs[0]).toMatchObject({ ok: false, rows: 4, error: `미룸 ${PER_WINDOW * 2 - 4}건` })
  })

  it('네트워크 오류와 저장 실패는 정해진 분류로만 남긴다', async () => {
    const a = api({ throwOn: (u) => u.searchParams.get('cond[item_cd::EQ]') === '245' })
    let n = 0
    const { d, runs } = deps({
      upsert: async () => {
        if (++n === 1) throw new Error('save_failed')
      },
    }, a)
    await handle(post(), d)
    expect(runs[0].error!.split(', ').sort()).toEqual(['network_error ×6', 'save_failed ×1'])
  })
})
