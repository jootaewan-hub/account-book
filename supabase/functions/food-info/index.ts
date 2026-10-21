// Edge Function 진입점: 성분(P7·P9·D-020). 권한 확인은 사용자 권한(RLS), 저장은 서비스 롤로 한다(verify_jwt true).
import { admin, cors, userClient, withCors } from '../_shared/edge.ts'
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
      if (data.product_id) {
        // 고른 상품의 이름으로 먼저 찾는다(D-018 보충 3). 상품 표는 가구 구분 없이 읽는다
        const { data: p, error: pe } = await g().from('products').select('name').eq('id', data.product_id).maybeSingle()
        if (pe) throw pe
        productName = p?.name ?? null
      }
      return { householdId: data.household_id, name: data.name, spec: data.spec, productName }
    },
    saveNutrition: async (itemId, row, auto, matchedBy) => {
      // 자동 맞춤은 고른 사람이 없고 jsonb에 auto와 matchedBy(product/name)를 남긴다(화면이 "상품명으로/이름으로 자동 맞춤"이라고 쓴다)
      const { data: me } = auto ? { data: null } : await user.auth.getUser(jwt)
      const { error } = await g().rpc('set_item_nutrition', {
        p_item: itemId, p_food_cd: row.foodCd, p_food_name: (row.foodName ?? '').slice(0, 200) || '이름 없음', p_maker: row.maker?.slice(0, 100) ?? null,
        p_nutrition: { ...row, auto, matchedBy: auto ? matchedBy : null }, p_chosen_by: auto ? null : (me?.user?.id ?? null),
      })
      if (error) throw error
    },
    saveIngredients: async (itemId, info, auto) => {
      // 자동 맞춤은 고른 사람이 없고 details에 auto와 matchedBy(product)를 남긴다(화면이 "상품명으로 자동 맞춤"이라고 쓴다). 소비기한·건강기능식품 기능성도 details에
      const { data: me } = auto ? { data: null } : await user.auth.getUser(jwt)
      const { error } = await g().rpc('set_item_ingredients', {
        p_item: itemId, p_origin: info.origin, p_report_no: info.reportNo, p_name: info.name.slice(0, 200), p_maker: info.maker?.slice(0, 100) ?? null,
        p_kind: info.kind?.slice(0, 60) ?? null, p_raw_materials: info.rawMaterials?.slice(0, 4000) ?? null, p_changed_on: info.changedOn,
        p_details: { shelfLife: info.shelfLife, health: info.health, auto, matchedBy: auto ? 'product' : null }, p_chosen_by: auto ? null : (me?.user?.id ?? null),
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
