// Claude API 인증(Workload Identity Federation): 로그인한 사용자의 Supabase JWT를 Anthropic 단기 토큰으로 바꾼다(저장하는 API 키 없음, D-009).
// 가계부 extract-entries/index.ts의 방식을 그대로 옮겼다(그 함수는 건드리지 않는다). WIF 설정이 없고 ANTHROPIC_API_KEY만 있으면 API 키로 동작한다.
// 식별자(WIF)는 비밀값이 아니다. Edge Function Secrets에 같은 이름이 있으면 그 값이 우선한다.
import Anthropic from '@anthropic-ai/sdk'
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation'

const WIF = {
  organizationId: '8a42cc87-a0e7-48c3-a585-1e5516755503',
  federationRuleId: 'fdrl_015wi1xrSFAdT226ifJwqkeS',
  serviceAccountId: 'svac_01CBKsgqV7oZmzZmwdx8jNQV',
  workspaceId: 'wrkspc_012QhQJ4YRCs77eLHJDVLAG4',
}

const ruleId = Deno.env.get('ANTHROPIC_FEDERATION_RULE_ID') || WIF.federationRuleId
const orgId = Deno.env.get('ANTHROPIC_ORGANIZATION_ID') || WIF.organizationId
const serviceAccountId = Deno.env.get('ANTHROPIC_SERVICE_ACCOUNT_ID') || WIF.serviceAccountId
const workspaceId = Deno.env.get('ANTHROPIC_WORKSPACE_ID') || WIF.workspaceId || undefined
export const useWif = Boolean(ruleId && orgId && serviceAccountId)

// 사용자별 클라이언트. SDK가 교환한 토큰을 만료 직전까지 재사용하고, 다시 교환할 때는 그 사용자의 가장 최근 JWT를 쓴다.
const clients = new Map<string, { client: Anthropic; jwt: string }>()

export function anthropicFor(userId: string, jwt: string): Anthropic | null {
  if (useWif) {
    const hit = clients.get(userId)
    if (hit) {
      hit.jwt = jwt
      return hit.client
    }
    const entry = { jwt, client: null as unknown as Anthropic }
    entry.client = new Anthropic({
      credentials: oidcFederationProvider({
        identityTokenProvider: () => entry.jwt,
        federationRuleId: ruleId,
        organizationId: orgId,
        serviceAccountId,
        workspaceId,
        baseURL: 'https://api.anthropic.com',
        fetch,
      }),
      maxRetries: 1,
    })
    clients.set(userId, entry)
    return entry.client
  }
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  return apiKey ? new Anthropic({ apiKey, maxRetries: 1 }) : null
}

/** 로그인 토큰이 WIF 교환에 쓸 수 있는 모양인지(비대칭 서명, aud에 Anthropic). 문제면 [code, message] */
export function wifTokenProblem(header: { alg?: unknown } | undefined, aud: unknown): [string, string] | null {
  if (!useWif) return null
  if (!/^(RS|ES|PS)/.test(String(header?.alg ?? ''))) {
    return ['wif_unsupported_jwt', 'Supabase 로그인 토큰 서명 방식이 WIF와 맞지 않아요 (JWT Keys를 비대칭 키로 바꿔야 해요).']
  }
  if (!(Array.isArray(aud) ? aud : [aud]).includes('https://api.anthropic.com')) {
    return ['wif_aud_missing', '로그인 토큰에 Anthropic 대상(aud)이 없어요. Supabase Auth Hook을 켠 뒤 다시 로그인해 주세요.']
  }
  return null
}
