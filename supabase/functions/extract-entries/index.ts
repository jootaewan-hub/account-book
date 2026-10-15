// 카드 문자·알림톡 텍스트 또는 영수증·캡처 사진에서 가계부 내역을 뽑는 Edge Function.
//
// Claude API 인증은 Workload Identity Federation(WIF)을 쓴다: 로그인한 사용자의 Supabase JWT를
// Anthropic 토큰 엔드포인트에서 짧게 사는 액세스 토큰으로 교환하므로 저장해 둘 API 키가 없다.
// WIF 설정이 없고 ANTHROPIC_API_KEY만 있으면 API 키로 동작한다.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation'
import { WorkloadIdentityError } from '@anthropic-ai/sdk/lib/credentials/types'
import { createClient } from '@supabase/supabase-js'
import {
  buildUserText, checkEntries, hasItemMismatch, IMAGE_MEDIA_TYPES, MAX_IMAGE_BASE64_CHARS, MAX_TEXT_CHARS,
  ResultSchema, SYSTEM_PROMPT, type CheckedEntry,
} from './extract.ts'

const PRIMARY_MODEL = Deno.env.get('EXTRACT_MODEL') ?? 'claude-haiku-5-5'
const RETRY_MODEL = Deno.env.get('EXTRACT_RETRY_MODEL') ?? 'claude-sonnet-5-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function fail(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status)
}

// 사용자별 Anthropic 클라이언트. SDK가 교환한 토큰을 만료 직전까지 재사용하고,
// 다시 교환할 때는 그 사용자의 가장 최근 JWT를 쓴다.
const clients = new Map<string, { client: Anthropic; jwt: string }>()

const ruleId = Deno.env.get('ANTHROPIC_FEDERATION_RULE_ID')
const orgId = Deno.env.get('ANTHROPIC_ORGANIZATION_ID')
const serviceAccountId = Deno.env.get('ANTHROPIC_SERVICE_ACCOUNT_ID')
const useWif = Boolean(ruleId && orgId && serviceAccountId)

function anthropicFor(userId: string, jwt: string): Anthropic | null {
  if (ruleId && orgId && serviceAccountId) {
    const hit = clients.get(userId)
    if (hit) { hit.jwt = jwt; return hit.client }
    const entry = { jwt, client: null as unknown as Anthropic }
    entry.client = new Anthropic({
      credentials: oidcFederationProvider({
        identityTokenProvider: () => entry.jwt,
        federationRuleId: ruleId,
        organizationId: orgId,
        serviceAccountId,
        workspaceId: Deno.env.get('ANTHROPIC_WORKSPACE_ID') || undefined,
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

type Input =
  | { kind: 'text'; text: string; today: string }
  | { kind: 'image'; image: { media_type: (typeof IMAGE_MEDIA_TYPES)[number]; data: string }; today: string }

function parseInput(body: unknown): Input | string {
  if (!body || typeof body !== 'object') return '요청 형식이 잘못됐어요.'
  const b = body as Record<string, unknown>
  const today = typeof b.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today)
    ? b.today
    : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) // 한국 시간
  if (b.kind === 'text') {
    const text = typeof b.text === 'string' ? b.text.trim() : ''
    if (!text) return '붙여넣은 내용이 없어요.'
    if (text.length > MAX_TEXT_CHARS) return `한 번에 ${MAX_TEXT_CHARS.toLocaleString()}자까지 보낼 수 있어요.`
    return { kind: 'text', text, today }
  }
  if (b.kind === 'image') {
    const img = b.image as Record<string, unknown> | undefined
    const mediaType = img?.media_type
    const data = img?.data
    if (typeof data !== 'string' || !IMAGE_MEDIA_TYPES.includes(mediaType as never)) return '사진 형식이 잘못됐어요.'
    if (data.length > MAX_IMAGE_BASE64_CHARS) return '사진이 너무 커요.'
    return { kind: 'image', image: { media_type: mediaType as (typeof IMAGE_MEDIA_TYPES)[number], data }, today }
  }
  return '요청 형식이 잘못됐어요.'
}

async function extract(client: Anthropic, model: string, input: Input, categories: string[]) {
  const userText = buildUserText({
    kind: input.kind, today: input.today, categories, text: input.kind === 'text' ? input.text : undefined,
  })
  const content: Anthropic.ContentBlockParam[] = input.kind === 'image'
    ? [{ type: 'image', source: { type: 'base64', media_type: input.image.media_type, data: input.image.data } },
       { type: 'text', text: userText }]
    : [{ type: 'text', text: userText }]
  const res = await client.messages.parse({
    model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'low', format: zodOutputFormat(ResultSchema) },
  })
  if (res.stop_reason === 'refusal') return { refused: true as const, usage: res.usage }
  if (!res.parsed_output) throw new Error(`no_parsed_output (stop_reason=${res.stop_reason})`)
  return { refused: false as const, result: res.parsed_output, entries: checkEntries(res.parsed_output), usage: res.usage }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST만 받아요.', 405)

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return fail('unauthorized', '로그인이 필요해요.', 401)

  const publishable = (() => {
    try { return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default as string | undefined } catch { return undefined }
  })() ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, publishable, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(jwt)
  const userId = claimsData?.claims?.sub
  if (claimsError || !userId) return fail('unauthorized', '로그인이 만료됐어요. 다시 로그인해 주세요.', 401)
  // Anthropic WIF는 비대칭 서명(RS*/ES*/PS*) JWT만 받는다
  if (useWif && !/^(RS|ES|PS)/.test(String(claimsData?.header?.alg ?? ''))) {
    console.error('wif_unsupported_jwt_alg', claimsData?.header?.alg)
    return fail('wif_unsupported_jwt', 'Supabase 로그인 토큰 서명 방식이 WIF와 맞지 않아요 (JWT Keys를 비대칭 키로 바꿔야 해요).', 500)
  }

  const input = parseInput(await req.json().catch(() => null))
  if (typeof input === 'string') return fail('bad_request', input, 400)

  // RLS로 본인 가구만 보인다
  const { data: member } = await supabase.from('members').select('household_id').eq('user_id', userId).maybeSingle()
  if (!member) return fail('no_household', '가계부에 참여한 뒤 쓸 수 있어요.', 403)
  const { data: cats } = await supabase.from('categories').select('name, type').eq('archived', false).order('sort')
  const categories = [...new Set((cats ?? []).map((c) => c.name as string))]

  const client = anthropicFor(userId, jwt)
  if (!client) return fail('ai_not_configured', 'AI 연결 설정이 아직 안 됐어요.', 503)

  try {
    let out = await extract(client, PRIMARY_MODEL, input, categories)
    let model = PRIMARY_MODEL
    // 품목 합계가 결제 금액과 안 맞으면 더 큰 모델로 한 번 더 읽는다
    if (!out.refused && hasItemMismatch(out.entries) && RETRY_MODEL !== PRIMARY_MODEL) {
      const second = await extract(client, RETRY_MODEL, input, categories)
      if (!second.refused && !hasItemMismatch(second.entries)) { out = second; model = RETRY_MODEL }
    }
    if (out.refused) return fail('refused', '이 내용은 읽을 수 없어요. 직접 입력해 주세요.', 422)
    const entries: CheckedEntry[] = out.entries
    return json({ entries, note: out.result.note, model, usage: out.usage })
  } catch (e) {
    if (e instanceof WorkloadIdentityError) {
      // 토큰 교환 거절: 클라이언트가 세션을 새로 고친 뒤 한 번 다시 시도한다
      console.error('wif_exchange_failed', e.statusCode, e.requestId, e.message)
      return fail('wif_denied', 'AI 연결 인증에 실패했어요.', 502)
    }
    if (e instanceof Anthropic.APIError) {
      console.error('anthropic_error', e.status, e.requestID, e.message)
      if (e.status === 429) return fail('rate_limited', '잠시 후 다시 시도해 주세요.', 429)
      return fail('ai_error', 'AI 응답에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', 502)
    }
    console.error('extract_failed', e)
    return fail('ai_error', '내용을 읽지 못했어요. 다시 시도하거나 직접 입력해 주세요.', 502)
  }
})
