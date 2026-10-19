// 사진으로 상품 찾기(product: 포장 앞면 → 이름·브랜드·용량)와 캡처로 가격 넣기(price: 쇼핑몰 캡처·가격표 → 판매처·상품명·가격·수량·용량·배송비).
// P4, D-009. 로그인한 사용자만 부른다(verify_jwt true). Claude 인증은 가계부와 같은 WIF(_shared/anthropic-wif.ts). 읽은 값은 그대로 돌려주고,
// 화면에서 사람이 확인·고친 뒤에만 쓴다. 모델은 코드에서만 정한다: 작은 글씨의 캡처·포장을 읽어야 해서 가계부 쇼핑 캡처와 같은 Sonnet 5.5.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { WorkloadIdentityError } from '@anthropic-ai/sdk/lib/credentials/types'
import { createClient } from '@supabase/supabase-js'
import { anthropicFor, wifTokenProblem } from '../_shared/anthropic-wif.ts'
import { buildUserText, checkPrice, checkProduct, parsePhotoInput, PRICE_PROMPT, PriceSchema, PRODUCT_PROMPT, productQuery, ProductSchema } from './photo.ts'

const MODEL = 'claude-sonnet-5-5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (code: string, message: string, status: number) => json({ error: { code, message } }, status)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('method_not_allowed', 'POST만 받아요.', 405)

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return fail('unauthorized', '로그인이 필요해요.', 401)
  const publishable = (() => {
    try {
      return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default as string | undefined
    } catch {
      return undefined
    }
  })() ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, publishable, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(jwt)
  const userId = claimsData?.claims?.sub
  if (claimsError || !userId) return fail('unauthorized', '로그인이 만료됐어요. 다시 로그인해 주세요.', 401)
  const problem = wifTokenProblem(claimsData?.header, claimsData?.claims?.aud)
  if (problem) {
    console.error(problem[0], claimsData?.header?.alg, claimsData?.claims?.aud)
    return fail(problem[0], problem[1], 500)
  }

  const input = parsePhotoInput(await req.json().catch(() => null))
  if (typeof input === 'string') return fail('bad_request', input, 400)

  // 가구 구성원만(RLS로 본인 가구만 보인다)
  const { data: member } = await supabase.from('members').select('household_id').eq('user_id', userId).maybeSingle()
  if (!member) return fail('no_household', '가계부에 참여한 뒤 쓸 수 있어요.', 403)

  const client = anthropicFor(userId, jwt)
  if (!client) return fail('ai_not_configured', 'AI 연결 설정이 아직 안 됐어요.', 503)

  const content: Anthropic.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: input.image.media_type, data: input.image.data } },
    { type: 'text', text: buildUserText(input.job, input.image) },
  ]
  try {
    if (input.job === 'product') {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 2000,
        system: PRODUCT_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: zodOutputFormat(ProductSchema) },
      })
      if (res.stop_reason === 'refusal') return fail('refused', '이 사진은 읽을 수 없어요. 이름을 직접 적어 주세요.', 422)
      if (!res.parsed_output) throw new Error(`no_parsed_output (stop_reason=${res.stop_reason})`)
      console.log('photo_product_ok', MODEL, '->', res.model, res.usage.input_tokens, res.usage.output_tokens)
      const product = checkProduct(res.parsed_output)
      return json({ job: 'product', product, query: productQuery(product), model: res.model })
    }
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: PRICE_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low', format: zodOutputFormat(PriceSchema) },
    })
    if (res.stop_reason === 'refusal') return fail('refused', '이 캡처는 읽을 수 없어요. 값을 직접 적어 주세요.', 422)
    if (!res.parsed_output) throw new Error(`no_parsed_output (stop_reason=${res.stop_reason})`)
    console.log('photo_price_ok', MODEL, '->', res.model, res.usage.input_tokens, res.usage.output_tokens)
    return json({ job: 'price', price: checkPrice(res.parsed_output), model: res.model })
  } catch (e) {
    if (e instanceof WorkloadIdentityError) {
      console.error('wif_exchange_failed', e.statusCode, e.requestId, e.message)
      return fail('wif_denied', 'AI 연결 인증에 실패했어요.', 502)
    }
    if (e instanceof Anthropic.APIError) {
      console.error('anthropic_error', e.status, e.requestID, e.message)
      if (e.status === 429) return fail('rate_limited', '잠시 후 다시 시도해 주세요.', 429)
      return fail('ai_error', 'AI 응답에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', 502)
    }
    console.error('photo_failed', e)
    return fail('ai_error', '사진을 읽지 못했어요. 다시 시도하거나 직접 적어 주세요.', 502)
  }
})
