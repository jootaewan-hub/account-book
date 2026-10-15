import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && key)

let client: SupabaseClient | null = null

export function sb(): SupabaseClient {
  if (!client) {
    if (!url || !key) throw new Error('Supabase 환경 변수가 없습니다')
    client = createClient(url, key, {
      // implicit: 가입 확인·비밀번호 재설정 링크가 메일 앱에서 Safari로 열려도 동작하도록
      // (PKCE는 요청한 브라우저 저장공간이 필요해 홈 화면 앱 ↔ Safari 사이에서 실패한다)
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    })
  }
  return client
}
