import { describe, expect, it } from 'vitest'
import { createRecipeStore } from '../../src/recipes/lib/store'
import { fakeClient } from './fakeClient'

const H = 'h1'
const U = 'u1'
const mk = (seed: Record<string, Record<string, unknown>[]> = {}) => {
  const f = fakeClient(seed)
  return { f, store: createRecipeStore(f.client, H, U) }
}

describe('주소 담기', () => {
  it('유튜브 주소를 정규 주소와 source_key로 inbox에 넣는다', async () => {
    const { f, store } = mk()
    const out = await store.addUrl('https://youtu.be/AkX6uA4BaDs')
    expect(out.kind).toBe('added')
    expect(f.tables['recipe.inbox']).toEqual([expect.objectContaining({
      household_id: H, url: 'https://www.youtube.com/watch?v=AkX6uA4BaDs', source_key: 'youtube:AkX6uA4BaDs', added_by: U,
    })])
  })
  it('인스타 주소는 서버를 부르지 않고 invalid', async () => {
    const { f, store } = mk()
    expect(await store.addUrl('https://www.instagram.com/reel/abc/')).toEqual({ kind: 'invalid' })
    expect(f.calls).toHaveLength(0)
  })
  it('같은 출처 레시피가 있으면 넣지 않고 exists_recipe, 보관한 것은 세지 않는다', async () => {
    const seed = { 'recipe.recipes': [{ id: 'r1', household_id: H, source_key: 'youtube:AkX6uA4BaDs', status: 'saved' }] }
    const a = mk(seed)
    expect(await a.store.addUrl('https://youtu.be/AkX6uA4BaDs')).toEqual({ kind: 'exists_recipe', id: 'r1' })
    expect(a.f.tables['recipe.inbox'] ?? []).toHaveLength(0)
    const b = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, source_key: 'youtube:AkX6uA4BaDs', status: 'archived' }] })
    expect((await b.store.addUrl('https://youtu.be/AkX6uA4BaDs')).kind).toBe('added')
  })
  it('넣기가 23505면 exists_job, 다른 오류는 던진다', async () => {
    const a = mk()
    a.f.failNext('recipe.inbox', 'insert', { code: '23505', message: 'dup' })
    expect(await a.store.addUrl('https://youtu.be/AkX6uA4BaDs')).toEqual({ kind: 'exists_job' })
    a.f.failNext('recipe.inbox', 'insert', { code: '42501', message: 'denied' })
    await expect(a.store.addUrl('https://youtu.be/AkX6uA4BaDs')).rejects.toThrow('denied')
  })
  it('다시 해 보기는 retry_job을 부르고 23505면 exists_job', async () => {
    const a = mk()
    expect(await a.store.retry('j1')).toBe('retried')
    expect(a.f.rpcs).toEqual([{ name: 'retry_job', args: { p_job: 'j1' } }])
    a.f.setRpc('retry_job', { data: null, error: { code: '23505', message: 'dup' } })
    expect(await a.store.retry('j1')).toBe('exists_job')
    a.f.setRpc('retry_job', { data: false, error: null })
    expect(await a.store.retry('j1')).toBe('unchanged')
  })
})

describe('만들 수 있는 것', () => {
  it('cookable을 가구와 모자란 수 한도로 부른다', async () => {
    const { f, store } = mk()
    f.setRpc('cookable', { data: [{ recipe_id: 'r1', have: 3, need: 4, missing: ['두부'] }], error: null })
    expect(await store.cookable(2)).toEqual([{ recipe_id: 'r1', have: 3, need: 4, missing: ['두부'] }])
    expect(f.rpcs).toEqual([{ name: 'cookable', args: { p_household: H, p_max_missing: 2 } }])
    f.setRpc('cookable', { data: null, error: null })
    expect(await store.cookable(0)).toEqual([])
  })
})

describe('지우기와 고치기', () => {
  it('archive는 status만 archived로 바꾸고 줄을 지우지 않는다', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', title: '김치찌개' }] })
    await store.archive('r1')
    expect(f.tables['recipe.recipes']).toEqual([{ id: 'r1', household_id: H, status: 'archived', title: '김치찌개' }])
    expect(f.calls.map((c) => c.op)).toEqual(['update'])
  })
  it('update는 허용된 칸만 보내고 값을 검사한다', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved' }] })
    await store.update('r1', { memo: ' 맛있음 ', rating: 4, review_items: [] } as never)
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ memo: '맛있음', rating: 4 })
    expect(f.tables['recipe.recipes'][0]).not.toHaveProperty('review_items')
    await expect(store.update('r1', { rating: 9 })).rejects.toThrow('별점')
    await expect(store.update('nope', { memo: 'x' })).rejects.toThrow('다른 기기')
  })
})

const recipeWithCorrections = () => mk({
  'recipe.recipes': [{
    id: 'r1', household_id: H, status: 'saved', servings: 2, servings_origin: 'user', glossary: [{ term: 'a', body: 'b', origin: 'editor', at_seconds: null }, { term: 'c', body: 'd', origin: 'asr', at_seconds: 80 }],
    corrections: [
      { target: 'ingredients[1].amount', before: '2', after: '3', origin: 'asr', at_seconds: 100, method: 'rule' },
      { target: 'ingredients[1].origin', before: 'caption_auto', after: 'asr', origin: 'asr', at_seconds: 100, method: 'compare' },
      { target: 'ingredients[1].at_seconds', before: '55', after: '100', origin: 'asr', at_seconds: 100, method: 'compare' },
      { target: 'steps[0].timer_seconds', before: 'null', after: '600', origin: 'asr', at_seconds: 30, method: 'rule' },
      { target: 'servings.value', before: '4', after: '2', origin: 'user', at_seconds: null, method: 'rule' },
      { target: 'glossary[1].origin', before: 'caption_auto', after: 'asr', origin: 'asr', at_seconds: 80, method: 'compare' },
    ],
  }],
  'recipe.ingredients': [
    { id: 'i0', household_id: H, recipe_id: 'r1', position: 1, amount: 1, origin: 'description' },
    { id: 'i1', household_id: H, recipe_id: 'r1', position: 2, amount: 3, origin: 'asr', at_seconds: 100 },
  ],
  'recipe.steps': [{ id: 's0', household_id: H, recipe_id: 'r1', position: 1, timer_seconds: 600, origin: 'asr' }],
})

describe('고친 곳 되돌리기(사람의 고름: 출처 user, 영상 시각 없음)', () => {
  it('값 고침을 되돌리면 before 값을 쓰고, 출처는 user·시각은 비우며 짝 고침도 지운다', async () => {
    const { f, store } = recipeWithCorrections()
    await store.revertCorrection('r1', 0)
    expect(f.tables['recipe.ingredients'][1]).toMatchObject({ amount: 2, origin: 'user', at_seconds: null })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 1, origin: 'description' })
    expect((f.tables['recipe.recipes'][0].corrections as { target: string }[]).map((c) => c.target))
      .toEqual(['steps[0].timer_seconds', 'servings.value', 'glossary[1].origin'])
  })
  it('출처 고침만 되돌려도 모델이 단 출처·시각으로 돌아가지 않는다(user, 시각 없음), 값은 그대로', async () => {
    const { f, store } = recipeWithCorrections()
    await store.revertCorrection('r1', 1)
    expect(f.tables['recipe.ingredients'][1]).toMatchObject({ amount: 3, origin: 'user', at_seconds: null })
    expect((f.tables['recipe.recipes'][0].corrections as { target: string }[]).map((c) => c.target))
      .toEqual(['ingredients[1].amount', 'steps[0].timer_seconds', 'servings.value', 'glossary[1].origin'])
  })
  it('at_seconds 고침에서 시작해도 origin 짝이 같이 되돌려진다', async () => {
    const { f, store } = recipeWithCorrections()
    await store.revertCorrection('r1', 2)
    expect((f.tables['recipe.recipes'][0].corrections as unknown[]).length).toBe(4)
    expect(f.tables['recipe.ingredients'][1]).toMatchObject({ origin: 'user', at_seconds: null })
  })
  it("'null' before는 null로. 단계 타이머·인분·용어 풀이도 되돌리면 출처는 user", async () => {
    const { f, store } = recipeWithCorrections()
    await store.revertCorrection('r1', 3)
    expect(f.tables['recipe.steps'][0]).toMatchObject({ timer_seconds: null, origin: 'user' })
    await store.revertCorrection('r1', 3) // 지운 줄 다음 순번이 당겨져 인분 고침이 된다
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ servings: 4, servings_origin: 'user' })
    await store.revertCorrection('r1', 3) // 용어 풀이 출처 고침
    expect((f.tables['recipe.recipes'][0].glossary as { origin: string; at_seconds: number | null }[])[1]).toMatchObject({ origin: 'user', at_seconds: null })
    expect((f.tables['recipe.recipes'][0].corrections as { target: string }[]).map((c) => c.target))
      .toEqual(['ingredients[1].amount', 'ingredients[1].origin', 'ingredients[1].at_seconds'])
  })
  it('없는 순번이나 알 수 없는 대상은 던진다', async () => {
    const { store } = recipeWithCorrections()
    await expect(store.revertCorrection('r1', 99)).rejects.toThrow()
  })

  // 검토 탐침(V1이 지운 숫자 되돌리기): 전에는 amount 3에 출처 asr·시각 95가 그대로 남아 "3큰술 · 말 1:35"로 보였다
  it('V1이 지운 숫자를 되돌리면 숫자는 사람이 고른 값(user)이고 시각은 없다. 그 칸의 확인 항목도 지운다', async () => {
    const { f, store } = mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', glossary: [],
        corrections: [{ target: 'ingredients[0].amount', before: '3큰술', after: null, origin: null, at_seconds: null, method: 'rule' }],
        review_items: [{ target: 'ingredients[0].amount', reason: '출처에서 숫자를 찾지 못함', candidates: [] }] }],
      'recipe.ingredients': [{ id: 'g1', household_id: H, recipe_id: 'r1', position: 1, name: '간장', amount: null, unit: '큰술', origin: 'asr', at_seconds: 95, needs_review: true }],
    })
    await store.revertCorrection('r1', 0)
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 3, unit: '큰술', origin: 'user', at_seconds: null, needs_review: false })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ review_items: [], status: 'saved', corrections: [] })
  })
  // 검토 탐침(V3 비교 되돌리기): 전에는 before '1큰술'을 숫자로 읽지 못해 "숫자로 읽을 수 없는 값이에요."로 실패했다
  it('V3 비교 고침(단위 붙은 값)을 되돌리면 숫자를 읽고, 단위가 같으면 단위는 그대로 둔다', async () => {
    const seed = (unit: string) => mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', glossary: [], review_items: [],
        corrections: [{ target: 'ingredients[0].amount', before: '1큰술', after: '2큰술', origin: 'screen', at_seconds: 120, method: 'compare' }] }],
      'recipe.ingredients': [{ id: 'g1', household_id: H, recipe_id: 'r1', position: 1, name: '간장', amount: 2, unit, origin: 'screen', at_seconds: 120 }],
    })
    const same = seed('T')
    await same.store.revertCorrection('r1', 0)
    expect(same.f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 1, unit: 'T', origin: 'user', at_seconds: null })
    // 단위가 다르면 단위도 쓴다(말없이 버리지 않는다)
    const other = seed('컵')
    await other.store.revertCorrection('r1', 0)
    expect(other.f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 1, unit: '큰술', origin: 'user', at_seconds: null })
  })
  it('숫자 분량 옆의 덧붙인 분량, 영상 밖 시각 고침은 되돌리지 않는다', async () => {
    const { store } = mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', review_items: [], corrections: [
        { target: 'ingredients[0].suggested_amount', before: '2큰술', after: null, origin: null, at_seconds: null, method: 'rule' },
        { target: 'steps[0].video_start_seconds', before: '999', after: null, origin: null, at_seconds: null, method: 'rule' },
      ] }],
      'recipe.ingredients': [{ id: 'g1', household_id: H, recipe_id: 'r1', position: 1, amount: 3, unit: '큰술', origin: 'description' }],
    })
    await expect(store.revertCorrection('r1', 0)).rejects.toThrow('되돌릴 수 없어요')
    await expect(store.revertCorrection('r1', 1)).rejects.toThrow('되돌릴 수 없어요')
  })
})

const reviewRecipe = () => mk({
  'recipe.recipes': [{
    id: 'r1', household_id: H, status: 'review', servings: null, servings_origin: null,
    conflicts: [{ about: 'x' }],
    review_items: [
      { target: 'ingredients[1].amount', reason: '두 값', candidates: [{ value: '2', origin: 'asr', at_seconds: 10 }, { value: '3', origin: 'caption_auto', at_seconds: 20 }] },
      { target: 'conflicts[0]', reason: '엇갈림', candidates: [] },
    ],
  }],
  'recipe.ingredients': [
    { id: 'i0', household_id: H, recipe_id: 'r1', position: 1, needs_review: false },
    { id: 'i1', household_id: H, recipe_id: 'r1', position: 2, amount: 2, origin: 'asr', at_seconds: 10, needs_review: true },
  ],
})

describe('확인 항목 처리', () => {
  it('고른 값을 user 출처로 두고 확인 표시와 항목을 지운다', async () => {
    const { f, store } = reviewRecipe()
    await store.resolveReview('r1', 0, { value: '3', origin: 'caption_auto', at_seconds: 20 })
    expect(f.tables['recipe.ingredients'][1]).toMatchObject({ amount: 3, origin: 'user', at_seconds: null, needs_review: false })
    const rec = f.tables['recipe.recipes'][0]
    expect((rec.review_items as { target: string }[]).map((x) => x.target)).toEqual(['conflicts[0]'])
    expect(rec.status).toBe('review')
  })
  it('남은 항목이 0이 되면 saved, 엇갈림 항목은 기록을 두고 항목만 지운다', async () => {
    const { f, store } = reviewRecipe()
    await store.resolveReview('r1', 0, { value: '2', origin: 'asr', at_seconds: 10 })
    await store.resolveReview('r1', 0, { value: '', origin: 'user', at_seconds: null })
    const rec = f.tables['recipe.recipes'][0]
    expect(rec.review_items).toEqual([])
    expect(rec.status).toBe('saved')
    expect(rec.conflicts).toEqual([{ about: 'x' }])
  })
  it('인분 항목은 servings와 servings_origin을 함께 쓴다', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', servings: null, servings_origin: null,
      review_items: [{ target: 'servings.value', reason: 'x', candidates: [] }] }] })
    await store.resolveReview('r1', 0, { value: '2', origin: 'asr', at_seconds: 5 })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ servings: 2, servings_origin: 'user', status: 'saved', review_items: [] })
  })
})

describe('확인 항목: 인분 비우기', () => {
  it('인분 항목을 빈 값으로 처리하면 servings와 servings_origin이 함께 null이다(제약 맞춤)', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', servings: 3, servings_origin: 'asr',
      review_items: [{ target: 'servings.value', reason: 'x', candidates: [] }] }] })
    await store.resolveReview('r1', 0, { value: '', origin: 'user', at_seconds: null })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ servings: null, servings_origin: null, status: 'saved', review_items: [] })
  })
})

describe('확인 항목: 계량 도구', () => {
  it('고른 도구를 쓰고 user 근거를 덧붙이며 항목을 지워 saved로 둔다', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', measuring_tool: '확인 못 함', measuring_tool_basis: [{ origin: 'asr', at_seconds: 3 }],
      review_items: [{ target: 'measuring_tool', reason: '스푼', candidates: [] }] }] })
    await expect(store.resolveReview('r1', 0, { value: '국자', origin: 'user', at_seconds: null })).rejects.toThrow()
    await store.resolveReview('r1', 0, { value: '계량스푼', origin: 'user', at_seconds: null })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ measuring_tool: '계량스푼', status: 'saved', review_items: [],
      measuring_tool_basis: [{ origin: 'asr', at_seconds: 3 }, { origin: 'user', at_seconds: null }] })
  })
})

describe('가진 재료', () => {
  it('없으면 넣고 있으면 상태만 고치며 null이면 지운다', async () => {
    const { f, store } = mk()
    await store.setPantry('egg', 'have')
    expect(f.tables['recipe.pantry']).toEqual([expect.objectContaining({ household_id: H, ingredient_key: 'egg', state: 'have', source: 'manual', added_by: U })])
    await store.setPantry('egg', 'always')
    expect(f.tables['recipe.pantry']).toHaveLength(1)
    expect(f.tables['recipe.pantry'][0]).toMatchObject({ state: 'always', source: 'manual' })
    const upd = f.calls.filter((c) => c.op === 'update').at(-1)?.payload as Record<string, unknown>
    expect(Object.keys(upd).sort()).toEqual(['noted_at', 'source', 'state'])
    await store.setPantry('egg', null)
    expect(f.tables['recipe.pantry']).toEqual([])
  })
  it('장보기에서 산 것으로 넣으면 출처가 grocery이고, 이미 있는 줄을 고칠 때도 그 출처를 쓴다', async () => {
    const { f, store } = mk()
    await store.setPantry('egg', 'have', 'grocery')
    expect(f.tables['recipe.pantry']).toEqual([expect.objectContaining({ ingredient_key: 'egg', state: 'have', source: 'grocery', added_by: U })])
    await store.setPantry('egg', 'always')
    expect(f.tables['recipe.pantry'][0]).toMatchObject({ state: 'always', source: 'manual' })
    await store.setPantry('egg', 'have', 'grocery')
    expect(f.tables['recipe.pantry'][0]).toMatchObject({ state: 'have', source: 'grocery' })
  })
})

describe('모자란 재료를 장보기에', () => {
  const dict = [
    { id: 'pork', name: '돼지고기', category: '육류' }, { id: 'green_onion', name: '대파', category: '채소' },
    { id: 'soy', name: '간장', category: '장·양념·소스' },
  ]
  const recipe = { ingredients: [
    { name: '돼지고기', ingredient_key: 'pork' }, { name: '대파', ingredient_key: 'green_onion' },
    { name: '진간장', ingredient_key: 'soy' }, { name: '비법', ingredient_key: null },
  ] }
  it('로그인 사용자로 이름·분류만 넣고 이미 목록에 있는 이름은 건너뛴다', async () => {
    const { f, store } = mk({
      'recipe.ingredient_dict': dict,
      'grocery.items': [{ id: 'g1', household_id: H, name: ' 대 파', bought_at: null }, { id: 'g2', household_id: H, name: '돼지고기', bought_at: '2026-11-01T00:00:00Z' }],
    })
    const n = await store.addMissingToGrocery(recipe, ['pork', 'green_onion', 'soy', 'unknown'])
    expect(n).toBe(2)
    const added = f.tables['grocery.items'].slice(2)
    expect(added).toEqual([
      expect.objectContaining({ household_id: H, name: '돼지고기', category: '정육', spec: null, count: 1, added_by: U }),
      expect.objectContaining({ name: '진간장', category: '가공', spec: null, count: 1, added_by: U }),
    ])
  })
  it('넣을 것이 없으면 0이고 아무것도 쓰지 않는다', async () => {
    const { f, store } = mk({ 'recipe.ingredient_dict': dict, 'grocery.items': [{ id: 'g1', household_id: H, name: '돼지고기', bought_at: null }] })
    expect(await store.addMissingToGrocery(recipe, ['pork'])).toBe(0)
    expect(f.calls.some((c) => c.table === 'grocery.items' && c.op === 'insert')).toBe(false)
  })
})

describe('실시간 구독', () => {
  it('가구 거르개를 걸고 채널 이름에 난수를 넣으며 해제하면 채널을 치운다', () => {
    const { f, store } = mk()
    const off = store.subscribe(() => {})
    const ch = f.channels[0]
    expect(ch.name).toMatch(/^recipes-h1-[0-9a-f-]{36}$/)
    const filters = ch.ons.map((o) => o.filter as { table: string; filter?: string; event: string })
    expect(filters.filter((x) => x.filter === `household_id=eq.${H}`).map((x) => x.table).sort()).toEqual(['inbox', 'inbox', 'pantry', 'pantry', 'recipes', 'recipes'])
    expect(filters.find((x) => x.table === 'worker_status')?.filter).toBeUndefined()
    off()
    expect(ch.removed).toBe(true)
  })
})

describe('덧붙인 값 비우기(DB check 제약)', () => {
  const seed = () => mk({
    'recipe.recipes': [{
      id: 'r1', household_id: H, status: 'review', servings: null, servings_origin: null, servings_suggested: 2,
      review_items: [{ target: 'servings.value', reason: 'x', candidates: [] }, { target: 'ingredients[0].amount', reason: 'y', candidates: [] }],
      corrections: [
        { target: 'ingredients[0].amount', before: '5', after: '1', origin: 'asr', at_seconds: 3, method: 'rule' },
        { target: 'servings.value', before: '4', after: '2', origin: 'user', at_seconds: null, method: 'rule' },
      ],
    }],
    'recipe.ingredients': [{ id: 'i0', household_id: H, recipe_id: 'r1', position: 1, amount: null, origin: 'editor', suggested_amount: 2, suggested_unit: 'g', needs_review: true }],
  })
  const updates = (f: ReturnType<typeof seed>['f'], table: string) => f.calls.filter((c) => c.table === table && c.op === 'update')
  it('확인 처리: 인분·분량을 쓰면 덧붙인 값을 같은 갱신에서 비운다', async () => {
    const { f, store } = seed()
    await store.resolveReview('r1', 0, { value: '3', origin: 'asr', at_seconds: 1 })
    expect(updates(f, 'recipe.recipes')[0].payload).toMatchObject({ servings: 3, servings_suggested: null })
    await store.resolveReview('r1', 0, { value: '7', origin: 'asr', at_seconds: 1 })
    expect(updates(f, 'recipe.ingredients')[0].payload).toMatchObject({ amount: 7, suggested_amount: null, suggested_unit: null })
  })
  it('되돌리기: 분량·인분을 되살릴 때도 덧붙인 값을 비운다', async () => {
    const { f, store } = seed()
    await store.revertCorrection('r1', 0)
    expect(updates(f, 'recipe.ingredients')[0].payload).toMatchObject({ amount: 5, suggested_amount: null, suggested_unit: null })
    await store.revertCorrection('r1', 0)
    expect(updates(f, 'recipe.recipes').at(-1)?.payload).toMatchObject({ servings: 4, servings_suggested: null })
  })
  it('분량을 null로 되돌리면 덧붙인 값은 건드리지 않는다', async () => {
    const { f, store } = mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', corrections: [{ target: 'ingredients[0].amount', before: 'null', after: '1', origin: 'asr', at_seconds: 3, method: 'rule' }] }],
      'recipe.ingredients': [{ id: 'i0', household_id: H, recipe_id: 'r1', position: 1, amount: 1 }],
    })
    await store.revertCorrection('r1', 0)
    expect(updates(f, 'recipe.ingredients')[0].payload).toEqual({ amount: null, origin: 'user', at_seconds: null })
  })
})

describe('상세 읽기와 재료·단계 고치기', () => {
  const seed = () => ({
    'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', title: '제육', cuisine: '한식', mains: ['돼지고기'], main_details: ['앞다리살'], methods: ['볶음'], occasions: [], favorite: false, added_at: 'a', updated_at: 'u', source_kind: 'youtube', source_key: 'youtube:AkX6uA4BaDs', servings: null, servings_suggested: 2 }],
    'recipe.ingredients': [
      { id: 'i0', household_id: H, recipe_id: 'r1', position: 2, name: '설탕', amount: 2, unit: '큰술', origin: 'asr', at_seconds: 242, ingredient_key: 'sugar', needs_review: true },
      { id: 'i1', household_id: H, recipe_id: 'r1', position: 1, name: '앞다리살', amount: 500, unit: 'g', origin: 'description' },
    ],
    'recipe.steps': [{ id: 's0', household_id: H, recipe_id: 'r1', position: 1, title: '손질', body: '썰기', origin: 'description' }],
  })
  it('getRecipe는 레시피·재료·단계를 순서대로 모으고 가구 밖이면 null', async () => {
    const { store } = mk(seed())
    const r = await store.getRecipe('r1')
    expect(r?.ingredients.map((g) => g.name)).toEqual(['앞다리살', '설탕'])
    expect(r?.servings.suggested).toBe(2)
    expect(await store.getRecipe('nope')).toBeNull()
  })
  it('editIngredient는 값을 고치고 출처를 user로, 영상 시각·확인 표시·사전 연결을 비운다', async () => {
    const { f, store } = mk(seed())
    await store.editIngredient('r1', 1, { name: '백설탕', amount: 3 })
    expect(f.tables['recipe.ingredients'].find((g) => g.id === 'i0')).toMatchObject({ name: '백설탕', amount: 3, origin: 'user', at_seconds: null, needs_review: false, ingredient_key: null })
    expect(f.tables['recipe.ingredients'].find((g) => g.id === 'i1')).toMatchObject({ name: '앞다리살', origin: 'description' })
    await expect(store.editIngredient('r1', 1, { name: ' ' })).rejects.toThrow('재료 이름')
    await expect(store.editIngredient('r1', 1, { amount: -1 })).rejects.toThrow('분량')
    await expect(store.editIngredient('r1', 9, { note: 'x' })).rejects.toThrow('이미 바뀌었어요')
  })
  it('editStep은 글을 고치고 출처를 user로 둔다', async () => {
    const { f, store } = mk(seed())
    await store.editStep('r1', 0, { body: ' 얇게 썰기 ' })
    expect(f.tables['recipe.steps'][0]).toMatchObject({ body: '얇게 썰기', origin: 'user' })
    await expect(store.editStep('r1', 0, { title: '' })).rejects.toThrow('단계 이름')
  })
})

describe('재료 고치기의 출처 규칙', () => {
  const seed = () => ({
    'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved' }],
    'recipe.ingredients': [{ id: 'i0', household_id: H, recipe_id: 'r1', position: 1, name: '후추', amount: null, amount_text: '약간', note: null, origin: 'asr', at_seconds: 242, needs_review: true }],
  })
  it('메모만 고치면 출처와 영상 시각을 그대로 둔다', async () => {
    const { f, store } = mk(seed())
    await store.editIngredient('r1', 0, { note: '넉넉히' })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ note: '넉넉히', origin: 'asr', at_seconds: 242, needs_review: true })
  })
  it('숫자 분량을 적으면 분량 글을 비우고 출처를 user로 둔다', async () => {
    const { f, store } = mk(seed())
    await store.editIngredient('r1', 0, { amount: 1, unit: '작은술' })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 1, unit: '작은술', amount_text: null, origin: 'user', at_seconds: null })
  })
})

describe('실제로 바뀐 값만 고친 것으로', () => {
  const seed = () => ({
    'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', review_items: [
      { target: 'ingredients[0].amount', reason: '흐려요', candidates: [] },
      { target: 'steps[0].body', reason: '흐려요', candidates: [] },
    ] }],
    'recipe.ingredients': [{ id: 'i0', household_id: H, recipe_id: 'r1', position: 1, name: '후추', amount: 2, unit: '큰술', note: null, origin: 'asr', at_seconds: 242, needs_review: true }],
    'recipe.steps': [{ id: 's0', household_id: H, recipe_id: 'r1', position: 1, title: '손질', body: '썰기', origin: 'asr', needs_review: true }],
  })
  it('같은 이름·분량에 메모만 달라졌다면 출처·시각·확인 표시와 확인 항목을 그대로 둔다', async () => {
    const { f, store } = mk(seed())
    await store.editIngredient('r1', 0, { name: '후추', amount: 2, unit: '큰술', note: '넉넉히' })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ note: '넉넉히', origin: 'asr', at_seconds: 242, needs_review: true })
    expect((f.tables['recipe.recipes'][0].review_items as unknown[]).length).toBe(2)
    expect(f.tables['recipe.recipes'][0].status).toBe('review')
  })
  it('값이 실제로 바뀌면 그 줄의 확인 항목만 지우고, 남은 것이 없으면 saved', async () => {
    const { f, store } = mk(seed())
    await store.editIngredient('r1', 0, { amount: 3 })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 3, origin: 'user', at_seconds: null, needs_review: false })
    expect((f.tables['recipe.recipes'][0].review_items as { target: string }[]).map((x) => x.target)).toEqual(['steps[0].body'])
    expect(f.tables['recipe.recipes'][0].status).toBe('review')
    await store.editStep('r1', 0, { title: '손질', body: '얇게 썰기' })
    expect(f.tables['recipe.steps'][0]).toMatchObject({ body: '얇게 썰기', origin: 'user', needs_review: false })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ review_items: [], status: 'saved' })
  })
  it('같은 값을 보내면 아무것도 쓰지 않는다', async () => {
    const { f, store } = mk(seed())
    await store.editIngredient('r1', 0, { name: '후추', amount: 2 })
    await store.editStep('r1', 0, { title: '손질', body: '썰기' })
    expect(f.calls.some((c) => c.op === 'update')).toBe(false)
  })
})

// 검토 탐침(C1): 처리기가 쓰는 꼴("2큰술", "2인분")의 후보를 고르면 전에는 "숫자로 읽을 수 없는 값이에요."로 실패했다
describe('확인 항목: 처리기가 쓴 꼴의 후보 값', () => {
  const seed = (unit: string | null, value: string, target = 'ingredients[0].amount') => mk({
    'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', measuring_tool_basis: [], servings: null, servings_origin: null,
      review_items: [{ target, reason: 'x', candidates: [{ value, origin: 'description', at_seconds: null }] }] }],
    'recipe.ingredients': [{ id: 'g1', household_id: H, recipe_id: 'r1', position: 1, name: '간장', amount: null, unit, origin: 'description', needs_review: true }],
  })
  it('"2큰술"을 고르면 분량 2, 단위가 같으면(T도 큰술) 단위는 그대로', async () => {
    for (const unit of ['큰술', 'T']) {
      const { f, store } = seed(unit, '2큰술')
      await store.resolveReview('r1', 0, { value: '2큰술', origin: 'description', at_seconds: null })
      expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 2, unit, origin: 'user', at_seconds: null, needs_review: false })
    }
  })
  it('단위가 다른 후보("1컵")를 고르면 분량과 단위를 함께 쓴다', async () => {
    const { f, store } = seed('큰술', '1컵')
    await store.resolveReview('r1', 0, { value: '1컵', origin: 'description', at_seconds: null })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 1, unit: '컵' })
  })
  it('단위 없는 줄에 단위 붙은 후보("3스푼")를 고르면 단위가 생긴다(단위를 읽지 못한 줄)', async () => {
    const { f, store } = seed(null, '3스푼')
    await store.resolveReview('r1', 0, { value: '3스푼', origin: 'description', at_seconds: null })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 3, unit: '스푼' })
  })
  it('단위 없는 값("2")은 그 줄의 단위를 둔다', async () => {
    const { f, store } = seed('큰술', '2')
    await store.resolveReview('r1', 0, { value: '2', origin: 'user', at_seconds: null })
    expect(f.tables['recipe.ingredients'][0]).toMatchObject({ amount: 2, unit: '큰술' })
  })
  it('"2인분"을 고르면 인분 2, 출처 user', async () => {
    const { f, store } = seed(null, '2인분', 'servings.value')
    await store.resolveReview('r1', 0, { value: '2인분', origin: 'description', at_seconds: null })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ servings: 2, servings_origin: 'user', status: 'saved' })
  })
  it('읽을 수 없는 값은 아무것도 쓰지 않고 던진다', async () => {
    const { f, store } = seed('큰술', '약간')
    await expect(store.resolveReview('r1', 0, { value: '약간', origin: 'user', at_seconds: null })).rejects.toThrow('숫자로 읽을 수 없는')
    expect(f.calls.filter((c) => c.op === 'update')).toEqual([])
  })
})

describe('확인 항목: 줄 전체를 가리키는 항목(M1)', () => {
  it('"ingredients[6]"(어느 단계에도 쓰이지 않음)을 확인하면 그 줄의 확인 표시를 끈다. 같은 줄의 다른 항목이 남으면 둔다', async () => {
    const { f, store } = mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', review_items: [
        { target: 'ingredients[1]', reason: '어느 단계에도 쓰이지 않음', candidates: [] },
        { target: 'ingredients[10].amount', reason: 'x', candidates: [] },
        { target: 'ingredients[0]', reason: '어느 단계에도 쓰이지 않음', candidates: [] },
        { target: 'ingredients[0].amount', reason: 'y', candidates: [] },
      ] }],
      // 가짜 클라이언트는 position을 글자로 줄 세우므로 두 줄만 둔다(ingredients[10] 항목은 접두어 견주기만 본다)
      'recipe.ingredients': [0, 1].map((i) => ({ id: `g${i}`, household_id: H, recipe_id: 'r1', position: i + 1, needs_review: true })),
    })
    await store.resolveReview('r1', 0, { value: '', origin: 'user', at_seconds: null }) // ingredients[1]: ingredients[10]은 다른 줄
    expect(f.tables['recipe.ingredients'][1]!.needs_review).toBe(false)
    await store.resolveReview('r1', 1, { value: '', origin: 'user', at_seconds: null }) // ingredients[0]: 같은 줄의 분량 항목이 남는다
    expect(f.tables['recipe.ingredients'][0]!.needs_review).toBe(true)
  })
  it('원리 항목("principles[0]")을 확인하면 레시피의 원리 JSON에서 표시를 끈다', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review',
      principles: [{ title: 't', body: 'b', origin: 'asr', needs_review: true }, { title: 'u', body: 'c', origin: 'asr', needs_review: true }],
      review_items: [{ target: 'principles[0]', reason: '정리할 때 확인 필요로 표시함', candidates: [] }] }] })
    await store.resolveReview('r1', 0, { value: '', origin: 'user', at_seconds: null })
    const rec = f.tables['recipe.recipes'][0]
    expect((rec.principles as { needs_review: boolean }[]).map((p) => p.needs_review)).toEqual([false, true])
    expect(rec).toMatchObject({ status: 'saved', review_items: [] })
  })
  it('재료를 고치면 그 줄 전체를 가리키는 항목도 지운다', async () => {
    const { f, store } = mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'review', review_items: [
        { target: 'ingredients[0]', reason: '어느 단계에도 쓰이지 않음', candidates: [] },
        { target: 'ingredients[10]', reason: '어느 단계에도 쓰이지 않음', candidates: [] },
      ] }],
      'recipe.ingredients': [{ id: 'g0', household_id: H, recipe_id: 'r1', position: 1, name: '간장', amount: 1, unit: '큰술', origin: 'asr', needs_review: true }],
    })
    await store.editIngredient('r1', 0, { amount: 2 })
    expect((f.tables['recipe.recipes'][0].review_items as { target: string }[]).map((x) => x.target)).toEqual(['ingredients[10]'])
  })
})

describe('난이도를 사람이 고르면(M6)', () => {
  it('셈한 근거를 비워 화면이 "직접 고침"으로 보이게 한다', async () => {
    const { f, store } = mk({ 'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', difficulty: '보통', difficulty_basis: { required: 9, steps: 7, heavy: false } }] })
    await store.update('r1', { difficulty: '쉬움' })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ difficulty: '쉬움', difficulty_basis: null })
    await store.update('r1', { memo: '메모' })
    expect(f.tables['recipe.recipes'][0]).toMatchObject({ difficulty: '쉬움', memo: '메모' })
  })
})

describe('목록: 재료 이름(M8)·치운 실패 일(M7)·사본 상태(I7)', () => {
  it('레시피 목록에 재료 이름을 함께 싣는다', async () => {
    const { store } = mk({
      'recipe.recipes': [{ id: 'r1', household_id: H, status: 'saved', title: '제육', added_at: 'a', mains: [], main_details: [] }],
      'recipe.ingredients': [
        { id: 'g0', household_id: H, recipe_id: 'r1', position: 1, name: '고추장' },
        { id: 'g1', household_id: H, recipe_id: 'r1', position: 2, name: '깻잎' },
      ],
    })
    expect((await store.listRecipes())[0]!.ingredient_names).toEqual(['고추장', '깻잎'])
  })
  it('대기함은 치운 실패 일을 빼고 읽고, 치우기는 dismiss_job을 부른다', async () => {
    const { f, store } = mk({ 'recipe.inbox': [
      { id: 'j1', household_id: H, state: 'failed', dismissed_at: null, added_at: '2' },
      { id: 'j2', household_id: H, state: 'failed', dismissed_at: '2026-11-22T00:00:00Z', added_at: '1' },
    ] })
    expect((await store.listInbox()).map((j) => j.id)).toEqual(['j1'])
    await store.dismiss('j1')
    expect(f.rpcs).toContainEqual({ name: 'dismiss_job', args: { p_job: 'j1' } })
  })
  it('처리기 상태는 사본 상태 칸도 읽는다', async () => {
    const { f, store } = mk({ 'recipe.worker_status': [{ id: 1, last_seen_at: 'x', version: 'v', export_issue: '옵시디언 폴더에 쓰지 못했어요', export_checked_at: 'y' }] })
    expect(await store.workerStatus()).toMatchObject({ export_issue: '옵시디언 폴더에 쓰지 못했어요', export_checked_at: 'y' })
    expect(f.calls.at(-1)?.table).toBe('recipe.worker_status')
  })
})
