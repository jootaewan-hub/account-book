// Edge Function 공용: 사용자 권한·서비스 롤 클라이언트, CORS, 다나와 요청.
// 사용자 권한 클라이언트는 요청의 로그인 JWT를 그대로 넘겨 RLS가 가구 소속을 확인하게 한다.
// verify_jwt = true(config.toml)라서 JWT가 없거나 틀리면 함수에 오기 전에 401이 난다.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

const URL_ = Deno.env.get('SUPABASE_URL')!
const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

/** 새 형식 키(SUPABASE_SECRET_KEYS·SUPABASE_PUBLISHABLE_KEYS의 default)를 먼저, 없으면 예전 형식 키. export-csv·extract-entries와 같다 */
function envKey(json: string, legacy: string): string {
  try {
    const v = (JSON.parse(Deno.env.get(json) ?? '{}') as Record<string, string>).default
    if (v) return v
  } catch { /* 예전 형식 키로 넘어간다 */ }
  return Deno.env.get(legacy) ?? ''
}

export const admin: SupabaseClient = createClient(URL_, envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), noSession)

export function userClient(req: Request): SupabaseClient {
  return createClient(URL_, envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    ...noSession,
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** 다나와 페이지를 받는다(20초 제한). 리다이렉트는 따라간다(검색 dsearch.php → /?query=). */
export async function fetchHtml(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  return { status: res.status, text: await res.text() }
}
