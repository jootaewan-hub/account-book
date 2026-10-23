// Edge Function 진입점: 성분(P7·P9·D-020). 권한 확인은 사용자 권한(RLS), 저장은 서비스 롤로 한다(verify_jwt true).
import { danawaProductUrl, parseDanawaProduct } from '../_shared/danawa.ts'
import { admin, cors, fetchHtml, userClient, withCors } from '../_shared/edge.ts'
import { MATCH_VERSION } from '../_shared/productMatch.ts'
import { handle } from './handle.ts'

const g = () => admin.schema('grocery')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const user = userClient(req)
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const res = await handle(req, {
    foodKey: Deno.env.get('FOODSAFETY_API_KEY'),
    dataKey: Deno.env.get('DATA_GO_KR_SERVICE_KEY'),
    fetchJson: async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        return { unreadable: res.status } // 파서가 "결과 코드 없음"으로 알린다(본문은 남기지 않는다)
      }
    },
    allowedItem: async (itemId) => {
      const { data, error } = await user.schema('grocery').from('items').select('household_id, name, spec, product_id').eq('id', itemId).maybeSingle()
      if (error) throw error
      if (!data) return null
      let productName: string | null = null
      let product = null
      if (data.product_id) {
        // 고른 상품의 이름과 다나와 정보(제조사 등, D-026)로 찾는다. 상품 표는 가구 구분 없이 읽는다
        const { data: p, error: pe } = await g().from('products').select('id, source_id, name, maker, brand, origin, materials, facts_at').eq('id', data.product_id).maybeSingle()
        if (pe) throw pe
        productName = p?.name ?? null
        if (p) product = { id: p.id, sourceId: p.source_id, facts: p.facts_at ? { maker: p.maker, brand: p.brand, origin: p.origin, materials: p.materials } : null }
      }
      return { householdId: data.household_id, name: data.name, spec: data.spec, productName, product }
    },
    loadFacts: async (product) => {
      // 다나와 상품 페이지(robots 허용 경로 /info/)를 한 번 읽어 제조사·상표·원산지·원재료명을 상품에 남긴다(값이 없어도 읽은 시각은 남겨 다시 읽지 않는다)
      const page = await fetchHtml(danawaProductUrl(product.sourceId))
      if (page.status !== 200) throw new Error(`http_${page.status}`)
      const facts = parseDanawaProduct(page.text, product.sourceId).facts
      const { error } = await g().from('products').update({ ...facts, facts_at: new Date().toISOString() }).eq('id', product.id)
      if (error) console.error('products 다나와 정보 저장 실패', error.message)
      return facts
    },
    clearAuto: async (itemId, version) => {
      const { error } = await g().rpc('clear_item_auto', { p_item: itemId, p_version: version })
      if (error) throw error
    },
    saveNutrition: async (itemId, row, auto, matchedBy) => {
      // 자동 맞춤은 고른 사람이 없고 jsonb에 auto·matchedBy(report/product/name)·v(맞춤 버전, D-026)를 남긴다(화면이 "보고번호로/상품명으로/이름으로 자동 맞춤"이라고 쓴다)
      const { data: me } = auto ? { data: null } : await user.auth.getUser(jwt)
      const { error } = await g().rpc('set_item_nutrition', {
        p_item: itemId, p_food_cd: row.foodCd, p_food_name: (row.foodName ?? '').slice(0, 200) || '이름 없음', p_maker: row.maker?.slice(0, 100) ?? null,
        p_nutrition: { ...row, auto, matchedBy: auto ? matchedBy : null, ...(auto ? { v: MATCH_VERSION } : {}) }, p_chosen_by: auto ? null : (me?.user?.id ?? null),
      })
      if (error) throw error
    },
    saveIngredients: async (itemId, info, auto) => {
      // 자동 맞춤은 고른 사람이 없고 details에 auto·matchedBy(product)·v(맞춤 버전, D-026)를 남긴다. 소비기한·건강기능식품 기능성도 details에
      const { data: me } = auto ? { data: null } : await user.auth.getUser(jwt)
      const { error } = await g().rpc('set_item_ingredients', {
        p_item: itemId, p_origin: info.origin, p_report_no: info.reportNo, p_name: info.name.slice(0, 200), p_maker: info.maker?.slice(0, 100) ?? null,
        p_kind: info.kind?.slice(0, 60) ?? null, p_raw_materials: info.rawMaterials?.slice(0, 4000) ?? null, p_changed_on: info.changedOn,
        p_details: { shelfLife: info.shelfLife, health: info.health, auto, matchedBy: auto ? 'product' : null, ...(auto ? { v: MATCH_VERSION } : {}) }, p_chosen_by: auto ? null : (me?.user?.id ?? null),
      })
      if (error) throw error
    },
    now: () => new Date(),
  }).catch((e) => {
    console.error('food-info 실패', e instanceof Error ? e.message : String(e))
    return new Response(JSON.stringify({ status: 'error' }), { status: 500, headers: { 'content-type': 'application/json' } })
  })
  return withCors(res)
})
