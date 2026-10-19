// Edge Function 진입점. 서비스 롤 클라이언트를 만들어 handle()에 넘긴다.
// DATA_GO_KR_SERVICE_KEY는 Supabase 함수 비밀값(공공데이터포털 키, 시세 15156057과 참가격 15158701이 같은 키). 호출 비밀번호는 없다:
// handle()이 20시간에 한 번만 실제로 받고, grocery.sync_lock(id 3) 잠금을 얻지 못하면(30분 안의 재시도) 429로 돌려보낸다.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { TpricePrice } from '../_shared/tprice.ts'
import { handle } from './handle.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const g = () => admin.schema('grocery')
const CHUNK = 500

Deno.serve((req) =>
  handle(req, {
    apiKey: Deno.env.get('DATA_GO_KR_SERVICE_KEY'),
    fetchText: async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(20_000) })
      return { status: res.status, text: await res.text() }
    },
    now: () => new Date(),
    recentOk: async (since) => {
      const { data, error } = await g().from('sync_runs').select('id').eq('source', 'tprice').eq('ok', true).gte('ran_at', since).limit(1)
      if (error) throw new Error(`sync_runs 읽기 실패: ${error.message}`)
      return (data ?? []).length > 0
    },
    acquire: async (cutoff, at) => {
      // 한 문장 UPDATE ... WHERE locked_at < cutoff: 동시에 불러도 하나만 1행을 돌려받는다
      const { data, error } = await g().from('sync_lock').update({ locked_at: at }).eq('id', 3).lt('locked_at', cutoff).select('id')
      if (error) throw new Error(`sync_lock 실패: ${error.message}`)
      return (data ?? []).length === 1
    },
    covered: async (entpIds, days) => {
      const { data, error } = await g().from('tprice_prices').select('entp_id, inspected_on').in('entp_id', entpIds).in('inspected_on', days)
      if (error) throw new Error(`tprice_prices 읽기 실패: ${error.message}`)
      return new Set(((data ?? []) as { entp_id: string; inspected_on: string }[]).map((r) => `${r.entp_id}|${r.inspected_on}`))
    },
    upsertStores: async (rows) => {
      const at = new Date().toISOString()
      const { error } = await g().from('tprice_stores').upsert(
        rows.map((s) => ({
          entp_id: s.entpId, name: s.entpName.slice(0, 60), type_code: s.entpTypeCode.slice(0, 4), area_code: s.entpAreaCode.slice(0, 12),
          area_detail_code: s.areaDetailCode.slice(0, 12), road_addr: s.roadAddr?.slice(0, 200) ?? null, telno: s.telno?.slice(0, 30) ?? null, fetched_at: at,
        })),
        { onConflict: 'entp_id' },
      )
      if (error) {
        console.error('tprice_stores 저장 실패', error.message)
        throw new Error('save_failed')
      }
    },
    upsertGoods: async (rows) => {
      const at = new Date().toISOString()
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await g().from('tprice_goods').upsert(
          rows.slice(i, i + CHUNK).map((x) => ({
            good_id: x.goodId, name: x.goodName.slice(0, 100), total_cnt: x.goodTotalCnt, total_div: x.goodTotalDivCode?.slice(0, 10) ?? null,
            base_cnt: x.goodBaseCnt, unit_div: x.goodUnitDivCode?.slice(0, 10) ?? null, smlcls_code: x.goodSmlclsCode?.slice(0, 12) ?? null,
            detail: x.detailMean?.slice(0, 100) ?? null, maker_code: x.productEntpCode?.slice(0, 20) ?? null, fetched_at: at,
          })),
          { onConflict: 'good_id' },
        )
        if (error) {
          console.error('tprice_goods 저장 실패', error.message)
          throw new Error('save_failed')
        }
      }
    },
    upsertPrices: async (rows: TpricePrice[]) => {
      const at = new Date().toISOString()
      const { error } = await g().from('tprice_prices').upsert(
        rows.map((p) => ({
          entp_id: p.entpId, good_id: p.goodId, inspected_on: p.goodInspectDay, price: p.goodPrice, input_at: p.inputAt,
          dc: p.dc, plus_one: p.plusOne, dc_start: p.dcStart, dc_end: p.dcEnd, fetched_at: at,
        })),
        { onConflict: 'entp_id,good_id,inspected_on' },
      )
      if (error) {
        console.error('tprice_prices 저장 실패', error.message)
        throw new Error('save_failed')
      }
    },
    log: (e) => console.log('tprice-sync', JSON.stringify(e)),
    recordRun: async (run) => {
      const { error } = await g().from('sync_runs').insert(run)
      if (error) console.error('sync_runs 기록 실패', error.message)
    },
  }),
)
