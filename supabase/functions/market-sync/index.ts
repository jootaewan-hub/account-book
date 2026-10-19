// Edge Function 진입점. 서비스 롤 클라이언트를 만들어 handle()에 넘긴다.
// DATA_GO_KR_SERVICE_KEY는 Supabase 함수 비밀값(사용자가 넣음, 공공데이터포털 15156057 활용신청 키). 호출 비밀번호는 없다:
// handle()이 20시간에 한 번만 실제로 받고, grocery.sync_lock(id 2) 잠금을 얻지 못하면(30분 안의 재시도) 429로 돌려보낸다.
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY는 Supabase가 함수 환경에 넣어 준다.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from './handle.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const g = () => admin.schema('grocery')

Deno.serve((req) =>
  handle(req, {
    apiKey: Deno.env.get('DATA_GO_KR_SERVICE_KEY'),
    fetchJson: async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        return { unreadable: res.status } // parseMarket이 "응답 형식을 읽지 못함"으로 알린다(본문은 남기지 않는다)
      }
    },
    now: () => new Date(),
    recentOk: async (since) => {
      const { data, error } = await g().from('sync_runs').select('id').eq('source', 'kamis').eq('ok', true).gte('ran_at', since).limit(1)
      if (error) throw new Error(`sync_runs 읽기 실패: ${error.message}`)
      return (data ?? []).length > 0
    },
    acquire: async (cutoff, at) => {
      // 한 문장 UPDATE ... WHERE locked_at < cutoff: 동시에 불러도 하나만 1행을 돌려받는다
      const { data, error } = await g().from('sync_lock').update({ locked_at: at }).eq('id', 2).lt('locked_at', cutoff).select('id')
      if (error) throw new Error(`sync_lock 실패: ${error.message}`)
      return (data ?? []).length === 1
    },
    covered: async (items, from, to) => {
      const { data, error } = await g().rpc('market_covered', { p_items: items, p_from: from, p_to: to })
      if (error) throw new Error(`market_covered 실패: ${error.message}`)
      return new Set(((data ?? []) as { item_cd: string }[]).map((r) => r.item_cd))
    },
    upsert: async (rows) => {
      const at = new Date().toISOString()
      const { error } = await g().from('price_points').upsert(
        rows.map((r) => ({ ...r, fetched_at: at })),
        { onConflict: 'item_cd,vrty_cd,grd_cd,sgg_cd,mrkt_cd,exmn_ymd' },
      )
      if (error) {
        console.error('price_points 저장 실패', error.message)
        throw new Error('save_failed')
      }
    },
    log: (e) => console.log('market-sync', JSON.stringify(e)),
    recordRun: async (run) => {
      const { error } = await g().from('sync_runs').insert(run)
      if (error) console.error('sync_runs 기록 실패', error.message)
    },
  }),
)
