// Edge Function 진입점: 알아보기 탭 날씨·미세먼지(D-035). 로그인한 사용자만 부른다(verify_jwt, config.toml).
// DATA_GO_KR_SERVICE_KEY는 Supabase 함수 비밀값(공공데이터포털, 기상청 15084084·에어코리아 15073861·15073877 활용신청이 필요하다).
import { cors, withCors } from '../_shared/edge.ts'
import { handle } from './handle.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  try {
    const res = await handle(req, {
      key: Deno.env.get('DATA_GO_KR_SERVICE_KEY'),
      get: async (url) => {
        const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
        return { status: r.status, text: await r.text() }
      },
      now: () => new Date(),
    })
    return withCors(res)
  } catch (e) {
    console.error('explore-weather 실패', e instanceof Error ? e.name : 'unknown')
    return withCors(new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }))
  }
})
