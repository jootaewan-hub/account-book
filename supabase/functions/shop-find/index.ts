// Edge Function 진입점: 몰 주소 자동 찾기(D-024). 로그인한 사용자만 부른다(verify_jwt true).
// 품목·상품 확인은 사용자 권한(RLS), 찾은 결과·확인 기록·자동 저장은 서비스 롤로 한다(가구 소속은 먼저 확인한다).
// 검색은 Claude 웹 검색(web_search, 가계부와 같은 WIF 인증, 저장하는 키 없음)을 컬리·홈플러스·쿠팡·로우차트 결과로만 좁혀 부르고,
// 응답에서는 검색 결과 주소만 쓴다(모델이 쓴 글·숫자는 쓰지 않는다). 가격은 그 상품 페이지에서 직접 읽는다.
// 웹 검색 요금: 1,000번에 10달러 + 토큰(2026-10-22 문서). 같은 상품은 한 번만 찾는다(handle.ts).
import Anthropic from '@anthropic-ai/sdk'
import { WorkloadIdentityError } from '@anthropic-ai/sdk/lib/credentials/types'
import { anthropicFor, wifTokenProblem } from '../_shared/anthropic-wif.ts'
import { admin, cors, fetchHtml, userClient, withCors } from '../_shared/edge.ts'
import { FIND_DOMAINS, FIND_SYSTEM, findPrompt, searchResultUrls, type FoundShop } from '../_shared/shopFind.ts'
import type { ShopSource } from '../_shared/shops.ts'
import { handle, SearchError } from './handle.ts'

// 검색어를 고르고 결과를 거르는 정도라 작은 일이지만, 웹 검색 지원이 문서로 확인된 Sonnet 5.5를 쓴다
const MODEL = 'claude-sonnet-5-5'
const MAX_SEARCHES = 4
// 함수 시간 제한(150초) 안에서 페이지 읽기 시간을 남긴다
const SEARCH_DEADLINE_MS = 90_000

const g = () => admin.schema('grocery')
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const fail = (code: string, status: number) =>
  withCors(new Response(JSON.stringify({ error: code }), { status, headers: { 'content-type': 'application/json' } }))

async function webSearch(client: Anthropic, name: string, spec: string | null): Promise<string[]> {
  const signal = AbortSignal.timeout(SEARCH_DEADLINE_MS)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: findPrompt(name, spec) }]
  const urls: string[] = []
  try {
    // 서버 쪽 검색이 길어지면 pause_turn으로 멈춘다. 받은 내용을 그대로 돌려 보내 두 번까지 잇는다
    for (let turn = 0; turn < 3; turn++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: FIND_SYSTEM,
        messages,
        tools: [{
          // 지역(user_location)은 넣지 않는다: 결과는 allowed_domains로 한국 몰에만 좁혀지고, 지원하지 않는 나라 코드는 400이다
          type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES, allowed_domains: [...FIND_DOMAINS],
        }],
        output_config: { effort: 'low' },
      }, { signal })
      urls.push(...searchResultUrls(res.content))
      // 검색 횟수와 토큰(비용 추정 확인용), 모은 주소 수
      console.log('shop_find_search', res.model, res.stop_reason, res.usage.server_tool_use?.web_search_requests ?? 0,
        res.usage.input_tokens, res.usage.output_tokens, urls.length)
      if (res.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: res.content })
    }
  } catch (e) {
    if (e instanceof WorkloadIdentityError) {
      console.error('wif_exchange_failed', e.statusCode, e.requestId, e.message)
      throw new SearchError('wif_denied')
    }
    if (e instanceof Anthropic.APIUserAbortError) throw new SearchError('timeout')
    if (e instanceof Anthropic.RateLimitError) throw new SearchError('rate_limited')
    if (e instanceof Anthropic.BadRequestError) {
      console.error('shop_find_bad_request', e.requestID, e.message)
      // 조직 설정에서 웹 검색을 끈 경우(문서: 400 invalid_request_error "web search is not enabled")
      throw new SearchError(/web search/i.test(e.message) ? 'search_disabled' : 'search_bad_request')
    }
    if (e instanceof Anthropic.APIError) {
      console.error('shop_find_api_error', e.status, e.requestID, e.message)
      throw new SearchError('search_failed')
    }
    throw e
  }
  return urls
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return fail('unauthorized', 401)
  const user = userClient(req)
  const { data: claimsData, error: claimsError } = await user.auth.getClaims(jwt)
  const userId = claimsData?.claims?.sub
  if (claimsError || !userId) return fail('unauthorized', 401)
  const problem = wifTokenProblem(claimsData?.header, claimsData?.claims?.aud)
  if (problem) {
    console.error(problem[0], claimsData?.header?.alg, claimsData?.claims?.aud)
    return fail(problem[0], 500)
  }
  const client = anthropicFor(userId, jwt)
  if (!client) return fail('ai_not_configured', 503)

  const res = await handle(req, {
    item: async (itemId) => {
      const { data, error } = await user.schema('grocery').from('items')
        .select('household_id, spec, product_id, products!items_product_id_fkey(name)').eq('id', itemId).maybeSingle()
      if (error) throw error
      if (!data) return null
      const p = data.products as unknown as { name: string } | { name: string }[] | null
      const product = Array.isArray(p) ? p[0] : p
      return { householdId: data.household_id, productId: data.product_id, productName: product?.name ?? null, spec: data.spec }
    },
    state: async (householdId, productId) => {
      const { data, error } = await g().from('shop_finds').select('status, searched_at, error')
        .eq('household_id', householdId).eq('product_id', productId).maybeSingle()
      if (error) throw error
      return data ? { status: data.status, searchedAt: data.searched_at, error: data.error } : null
    },
    claim: async (householdId, productId, at, prev) => {
      if (!prev) {
        const { error } = await g().from('shop_finds').insert({ household_id: householdId, product_id: productId, status: 'searching', searched_at: at })
        if (error?.code === '23505') return false // 다른 요청이 먼저 넣었다
        if (error) throw error
        return true
      }
      // 읽은 그 상태 그대로일 때만 바꾼다(두 사람이 동시에 불러도 한 번만 찾게)
      const { data, error } = await g().from('shop_finds').update({ status: 'searching', searched_at: at, error: null, candidates: [] })
        .eq('household_id', householdId).eq('product_id', productId).eq('status', prev.status).eq('searched_at', prev.searchedAt).select('product_id')
      if (error) throw error
      return (data ?? []).length > 0
    },
    linked: async (householdId, productId) => {
      const { data, error } = await g().from('shop_links').select('source').eq('household_id', householdId).eq('product_id', productId)
      if (error) throw error
      return ((data ?? []) as { source: ShopSource }[]).map((r) => r.source)
    },
    search: (name, spec) => webSearch(client, name, spec),
    todayCheck: async (link) => {
      const { data, error } = await g().from('shop_checks').select('name, size, price, checked_at')
        .eq('source', link.source).eq('source_id', link.sourceId).eq('ok', true).eq('checked_on', kstToday())
        .order('checked_at', { ascending: false }).limit(1)
      if (error) throw error
      const r = (data ?? [])[0] as { name: string; size: string | null; price: number; checked_at: string } | undefined
      return r ? { name: r.name, size: r.size, price: r.price, checkedAt: r.checked_at } : null
    },
    fetchHtml,
    saveCheck: async (link, p, at) => {
      const { error } = await g().from('shop_checks').insert({
        source: link.source, source_id: link.sourceId, checked_at: at, ok: true,
        name: p.name.slice(0, 200), price: p.price, image_url: p.imageUrl, rating: p.rating, review_count: p.reviewCount,
        size: p.size?.slice(0, 40) ?? null, price_from: p.priceFrom,
        obs_low: p.observed?.low ?? null, obs_high: p.observed?.high ?? null, obs_avg: p.observed?.avg ?? null, changed_on: p.observed?.changedOn ?? null,
      })
      if (error) throw error
    },
    failCheck: async (link, err, at) => {
      const { error } = await g().from('shop_checks').insert({ source: link.source, source_id: link.sourceId, checked_at: at, ok: false, error: err })
      if (error) console.error('shop_checks 기록 실패', error.message)
    },
    saveLink: async (householdId, productId, link) => {
      // 사람이 그새 넣은 주소가 있으면 그대로 둔다
      const { error } = await g().from('shop_links').upsert(
        { household_id: householdId, product_id: productId, source: link.source, source_id: link.sourceId, url: link.url, added_by: userId },
        { onConflict: 'household_id,product_id,source', ignoreDuplicates: true },
      )
      if (error) throw error
    },
    finish: async (householdId, productId, status, candidates: FoundShop[], err) => {
      const { error } = await g().from('shop_finds').update({ status, candidates, error: err })
        .eq('household_id', householdId).eq('product_id', productId)
      if (error) throw error
    },
    now: () => new Date(),
  }).catch((e) => {
    console.error('shop-find 실패', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  })
  return withCors(res)
})
