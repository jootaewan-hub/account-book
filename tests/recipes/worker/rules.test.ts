import { describe, expect, it } from 'vitest'
import { parseRecipe, type RecipeV2 } from '../../../supabase/functions/_shared/recipeContract.ts'
import type { Evidence } from '../../../tools/recipe-worker/src/evidence'
import { REASONS, checkRecipe } from '../../../tools/recipe-worker/src/verify/rules'

// 근거와 레시피는 모두 만든 자료다(공개 저장소라 실제 자막·설명란을 넣지 않는다).

function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    meta: {
      id: 'AAAAAAAAAAA', title: '시험 영상', channel: '시험 채널', uploadDate: null, duration: 300,
      description: '[재료] 2인분\n돼지고기 500g\n간장 3큰술\n설탕 2T\n소금 약간',
      chapters: [],
    },
    transcript: {
      kind: 'caption_auto',
      segments: [
        { start: 10, text: '오늘은 고기 볶음을 만들어 볼게요' },
        { start: 40, text: '양파 하나를 썰어 주세요' },
        { start: 60, text: '참기름은 한 스푼' },
        { start: 120, text: '센 불에서 3분 정도 볶아요' },
        { start: 200, text: '한소끔 끓으면 불을 꺼요' },
        { start: 230, text: '마지막에 30초만 더' },
      ],
    },
    ocr: [{ t: 80, text: '고춧가루 1큰술' }],
    frames: [],
    ...over,
  }
}

function recipe(): RecipeV2 {
  return {
    contract_version: '2',
    source: {
      kind: 'youtube', key: 'youtube:AAAAAAAAAAA', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
      title: '시험 영상', channel: '시험 채널', published_on: null, duration_seconds: 300,
    },
    title: '고기 볶음',
    servings: { value: 2, origin: 'description' },
    tags: { cuisine: '한식', mains: ['돼지고기'], main_details: ['돼지고기'], methods: ['볶음'], occasions: ['반찬'] },
    ingredients: [
      { name: '돼지고기', amount: 500, unit: 'g', origin: 'description' },
      { name: '간장', amount: 3, unit: '큰술', origin: 'description' },
      { name: '설탕', amount: 2, unit: '큰술', origin: 'description' },
      { name: '양파', amount: 1, unit: '개', origin: 'caption_auto', at_seconds: 40 },
      { name: '고춧가루', amount: 1, unit: '큰술', origin: 'screen', at_seconds: 80 },
      { name: '소금', amount: null, unit: null, amount_text: '약간', origin: 'description' },
    ],
    measuring_tool: '확인 못 함',
    steps: [
      { title: '썰기', body: '양파를 썬다.', video_start_seconds: 40, uses: [{ name: '양파' }], origin: 'caption_auto' },
      {
        title: '볶기', body: '고기에 양념을 넣고 센 불에서 볶는다.', video_start_seconds: 120, timer_seconds: 180,
        uses: [{ name: '돼지고기' }, { name: '간장' }, { name: '설탕' }, { name: '고춧가루' }, { name: '소금' }], origin: 'caption_auto',
      },
    ],
    extraction: {
      levels: ['L0', 'L1', 'L3'], transcript_kind: 'caption_auto', tools: [], extracted_by: '시험',
      extracted_at: '2026-11-19T00:00:00+09:00',
    },
  }
}

type Out = ReturnType<typeof checkRecipe>

/** 모든 결과가 지켜야 하는 것: 계약·DB 제약 통과, needs_review ⇔ 확인 필요 항목, 고친 곳에 근거 원문 없음(P-06) */
function invariant(out: Out, e: Evidence) {
  const p = parseRecipe(out.recipe)
  if (!p.ok) throw new Error(p.errors.join('\n'))
  const r = out.recipe
  const items = r.review_items ?? []
  const covered = (prefix: string) => items.some((it) => it.target === prefix || it.target.startsWith(`${prefix}.`))
  r.ingredients.forEach((g, i) => expect(Boolean(g.needs_review), `ingredients[${i}]`).toBe(covered(`ingredients[${i}]`)))
  r.steps.forEach((s, i) => expect(Boolean(s.needs_review), `steps[${i}]`).toBe(covered(`steps[${i}]`)))
  ;(r.principles ?? []).forEach((x, i) => expect(Boolean(x.needs_review), `principles[${i}]`).toBe(covered(`principles[${i}]`)))
  for (const g of r.ingredients) {
    if (g.amount !== null) {
      expect(g.origin).not.toBe('editor')
      expect(g.suggested_amount ?? null).toBeNull()
      expect(g.suggested_unit ?? null).toBeNull()
    }
  }
  for (const s of r.steps) if (s.timer_seconds != null) expect(s.origin).not.toBe('editor')
  expect(r.servings.value === null).toBe(r.servings.origin === null)
  const texts = [
    ...(e.transcript?.segments.map((s) => s.text) ?? []),
    ...e.ocr.map((l) => l.text),
    ...e.meta.description.split('\n'),
  ].filter((t) => t.length >= 6)
  for (const c of r.corrections ?? []) {
    for (const t of texts) {
      expect(c.before ?? '').not.toContain(t)
      expect(c.after ?? '').not.toContain(t)
    }
  }
  for (const it of items) for (const c of it.candidates) for (const t of texts) expect(c.value).not.toContain(t)
}

function run(r: RecipeV2, e = evidence()): Out {
  const before = structuredClone(r)
  const out = checkRecipe(r, e)
  expect(r).toEqual(before) // 받은 레시피를 바꾸지 않는다
  invariant(out, e)
  return out
}

describe('checkRecipe', () => {
  it('근거에 다 있는 레시피는 그대로(큰술만 쓰였으면 계량 도구 확인 필요도 없음)', () => {
    const out = run(recipe())
    expect(out.corrections).toEqual([])
    expect(out.reviews).toEqual([])
    expect(out.recipe).toEqual(recipe())
  })

  it('단 출처에 없고 설명란에 있는 숫자 → 출처를 설명란으로 고침', () => {
    const r = recipe()
    r.ingredients[1] = { name: '간장', amount: 3, unit: '큰술', origin: 'caption_auto', at_seconds: 60 }
    const out = run(r)
    expect(out.recipe.ingredients[1]).toMatchObject({ amount: 3, origin: 'description', at_seconds: null })
    // 출처와 시각을 따로 남겨 둘 다 되돌릴 수 있게
    expect(out.corrections).toEqual([
      { target: 'ingredients[1].origin', before: 'caption_auto', after: 'description', origin: 'description', at_seconds: null, method: 'rule' },
      { target: 'ingredients[1].at_seconds', before: '60', after: null, origin: 'description', at_seconds: null, method: 'rule' },
    ])
    expect(out.reviews).toEqual([])
    expect(out.recipe.corrections).toEqual(out.corrections)
  })

  it('말 출처에 없고 화면에 있으면 화면으로, 시각은 그 글자 줄의 시각', () => {
    const r = recipe()
    r.ingredients[4] = { name: '고춧가루', amount: 1, unit: '큰술', origin: 'caption_auto', at_seconds: 70 }
    const out = run(r)
    expect(out.recipe.ingredients[4]).toMatchObject({ origin: 'screen', at_seconds: 80 })
    expect(out.corrections).toEqual([
      { target: 'ingredients[4].origin', before: 'caption_auto', after: 'screen', origin: 'screen', at_seconds: 80, method: 'rule' },
      { target: 'ingredients[4].at_seconds', before: '70', after: '80', origin: 'screen', at_seconds: 80, method: 'rule' },
    ])
  })

  it('같은 출처의 다른 시각에 있으면 시각만 고침', () => {
    const r = recipe()
    r.ingredients[4] = { name: '고춧가루', amount: 1, unit: '큰술', origin: 'screen', at_seconds: 150 }
    const out = run(r)
    expect(out.recipe.ingredients[4]).toMatchObject({ origin: 'screen', at_seconds: 80 })
    expect(out.corrections).toEqual([
      { target: 'ingredients[4].at_seconds', before: '150', after: '80', origin: 'screen', at_seconds: 80, method: 'rule' },
    ])
  })

  it('자막 종류가 근거와 다르면 근거의 종류로 고침', () => {
    const r = recipe()
    r.ingredients[3] = { name: '양파', amount: 1, unit: '개', origin: 'asr', at_seconds: 40 }
    const out = run(r)
    expect(out.recipe.ingredients[3]).toMatchObject({ origin: 'caption_auto', at_seconds: 40 })
    expect(out.corrections.map((c) => c.target)).toEqual(['ingredients[3].origin']) // 시각은 그대로라 하나
  })

  it('덧붙임(editor) 출처의 숫자도 근거에서 찾아 출처를 고침', () => {
    const r = recipe()
    r.ingredients[2] = { name: '설탕', amount: 2, unit: '큰술', origin: 'editor' }
    const out = run(r)
    expect(out.recipe.ingredients[2]).toMatchObject({ amount: 2, origin: 'description' })
    expect(out.corrections.map((c) => [c.target, c.before, c.after])).toEqual([['ingredients[2].origin', 'editor', 'description']])
  })

  it('어디에도 없는 숫자 → amount null, amount_text는 남기고 확인 필요 "출처에서 숫자를 찾지 못함"', () => {
    const r = recipe()
    r.ingredients.push({ name: '참깨', amount: 2, unit: '큰술', amount_text: '듬뿍', origin: 'description' })
    r.steps[1]!.uses!.push({ name: '참깨' })
    const out = run(r)
    expect(out.recipe.ingredients[6]).toMatchObject({ name: '참깨', amount: null, unit: '큰술', amount_text: '듬뿍', needs_review: true })
    expect(out.reviews).toEqual([{ target: 'ingredients[6].amount', reason: '출처에서 숫자를 찾지 못함', candidates: [] }])
    expect(out.corrections).toEqual([
      { target: 'ingredients[6].amount', before: '2', after: null, origin: null, at_seconds: null, method: 'rule' },
    ])
    expect(out.recipe.review_items).toEqual(out.reviews)
  })

  it('T와 t는 대소문자 그대로: 설명란 "설탕 2T"는 2작은술의 근거가 아니고, 근처 숫자는 후보로', () => {
    const r = recipe()
    r.ingredients[2] = { name: '설탕', amount: 2, unit: '작은술', origin: 'description' }
    const out = run(r)
    expect(out.recipe.ingredients[2]!.amount).toBeNull()
    expect(out.reviews).toEqual([
      { target: 'ingredients[2].amount', reason: REASONS.amount, candidates: [{ value: '2큰술', origin: 'description', at_seconds: null }] },
    ])
  })

  it('영상 시각이 길이를 넘는 숫자는 어디에도 없으면 숫자와 시각을 지움', () => {
    const r = recipe()
    r.ingredients[3] = { name: '양파', amount: 3, unit: '개', origin: 'caption_auto', at_seconds: 999 }
    const out = run(r)
    expect(out.recipe.ingredients[3]).toMatchObject({ amount: null, at_seconds: null, needs_review: true })
    expect(out.corrections.map((c) => c.target)).toEqual(['ingredients[3].amount', 'ingredients[3].at_seconds'])
  })

  it('단계 uses에만 있는 재료 → 재료 목록 끝에 더하고 고친 곳', () => {
    const r = recipe()
    r.steps[1]!.uses!.push({ name: '대파' })
    const out = run(r)
    expect(out.recipe.ingredients).toHaveLength(7)
    expect(out.recipe.ingredients[6]).toMatchObject({ name: '대파', amount: null, unit: null, origin: 'caption_auto' })
    expect(out.corrections).toEqual([
      { target: 'ingredients[6]', before: null, after: '대파', origin: 'caption_auto', at_seconds: 120, method: 'rule' },
    ])
    expect(out.reviews).toEqual([])
  })

  it('띄어쓰기만 다른 uses 이름은 재료 이름으로 맞춤(새 재료를 만들지 않음)', () => {
    const r = recipe()
    r.ingredients.push({ name: '다진 마늘', amount: null, unit: null, amount_text: '약간', origin: 'description' })
    r.steps[1]!.uses!.push({ name: '다진마늘' })
    const out = run(r)
    expect(out.recipe.ingredients).toHaveLength(7)
    expect(out.recipe.steps[1]!.uses!.at(-1)).toEqual({ name: '다진 마늘' })
    expect(out.corrections).toEqual([
      { target: 'steps[1].uses[5].name', before: '다진마늘', after: '다진 마늘', origin: 'caption_auto', at_seconds: 120, method: 'rule' },
    ])
  })

  it('어느 단계에도 안 쓰인 필수 재료 → 확인 필요, 없어도 되는 재료나 단계 글에 나온 재료는 아님', () => {
    const r = recipe()
    r.ingredients.push(
      { name: '깻잎', amount: null, unit: null, amount_text: '조금', origin: 'description' },
      { name: '통깨', amount: null, unit: null, amount_text: '약간', origin: 'description', optional: true },
      { name: '양념', amount: null, unit: null, amount_text: '약간', origin: 'description' },
    )
    const out = run(r)
    expect(out.reviews).toEqual([{ target: 'ingredients[6]', reason: '어느 단계에도 쓰이지 않음', candidates: [] }])
    expect(out.recipe.ingredients[6]!.needs_review).toBe(true)
    expect(out.recipe.ingredients[7]!.needs_review).toBeUndefined()
  })

  it('영상 길이보다 큰 video_start_seconds → null과 고친 곳(원리·다른 곳도)', () => {
    const r = recipe()
    r.steps[0]!.video_start_seconds = 999
    r.principles = [{ title: '센 불', body: '물기를 날린다.', origin: 'caption_auto', video_start_seconds: 301 }]
    const out = run(r)
    expect(out.recipe.steps[0]!.video_start_seconds).toBeNull()
    expect(out.recipe.principles![0]!.video_start_seconds).toBeNull()
    expect(out.corrections).toEqual([
      { target: 'steps[0].video_start_seconds', before: '999', after: null, origin: null, at_seconds: null, method: 'rule' },
      { target: 'principles[0].video_start_seconds', before: '301', after: null, origin: null, at_seconds: null, method: 'rule' },
    ])
  })

  it('분량에 "스푼"·"숟가락"이 쓰였고 계량 도구를 확인 못 했으면 확인 필요', () => {
    const r = recipe()
    r.ingredients.push({ name: '참기름', amount: 1, unit: '스푼', origin: 'caption_auto', at_seconds: 60 })
    r.steps[1]!.uses!.push({ name: '참기름' })
    const out = run(r)
    expect(out.recipe.ingredients[6]!.amount).toBe(1)
    expect(out.reviews).toEqual([{ target: 'measuring_tool', reason: '계량스푼인지 밥숟가락인지 확인 못 함', candidates: [] }])

    const known = recipe()
    known.ingredients.push({ name: '참기름', amount: 1, unit: '스푼', origin: 'caption_auto', at_seconds: 60 })
    known.steps[1]!.uses!.push({ name: '참기름' })
    known.measuring_tool = '밥숟가락'
    expect(run(known).reviews).toEqual([])

    const text = recipe()
    text.ingredients[5] = { name: '소금', amount: null, unit: null, amount_text: '한 숟가락', origin: 'description' }
    expect(run(text).reviews.map((x) => x.target)).toEqual(['measuring_tool'])

    const named = recipe()
    named.ingredients[5] = { name: '소금', amount: null, unit: null, amount_text: '1티스푼', origin: 'description' }
    expect(run(named).reviews).toEqual([])
  })

  it('영상 출처를 단 용어 풀이의 말이 그 시각 근거에 없으면 출처를 editor로', () => {
    const r = recipe()
    r.glossary = [
      { term: '한소끔', body: '한 번 끓어오를 만큼.', origin: 'caption_auto', at_seconds: 205 },
      { term: '자작하게', body: '국물이 재료에 겨우 닿을 만큼.', origin: 'caption_auto', at_seconds: 120 },
      { term: '미림', body: '요리용 단 술.', origin: 'editor', at_seconds: null },
      { term: '한소끔', body: '한 번 끓어오를 만큼.', origin: 'screen', at_seconds: 200 },
    ]
    const out = run(r)
    expect(out.recipe.glossary).toEqual([
      { term: '한소끔', body: '한 번 끓어오를 만큼.', origin: 'caption_auto', at_seconds: 205 },
      { term: '자작하게', body: '국물이 재료에 겨우 닿을 만큼.', origin: 'editor', at_seconds: null },
      { term: '미림', body: '요리용 단 술.', origin: 'editor', at_seconds: null },
      { term: '한소끔', body: '한 번 끓어오를 만큼.', origin: 'editor', at_seconds: null },
    ])
    expect(out.corrections.map((c) => [c.target, c.before, c.after])).toEqual([
      ['glossary[1].origin', 'caption_auto', 'editor'],
      ['glossary[1].at_seconds', '120', null],
      ['glossary[3].origin', 'screen', 'editor'],
      ['glossary[3].at_seconds', '200', null],
    ])
    expect(out.reviews).toEqual([])
  })

  it('덧붙인 분량이 숫자 재료에 있으면 지우고 고친 곳, 숫자가 없는 재료의 덧붙임은 둠', () => {
    const r = recipe()
    r.ingredients[1] = { name: '간장', amount: 3, unit: '큰술', origin: 'description', suggested_amount: 2, suggested_unit: '큰술' }
    r.ingredients[5] = { name: '소금', amount: null, unit: null, amount_text: '약간', origin: 'editor', suggested_amount: 0.5, suggested_unit: '작은술' }
    const out = run(r)
    expect(out.recipe.ingredients[1]).toMatchObject({ amount: 3, suggested_amount: null, suggested_unit: null })
    expect(out.recipe.ingredients[5]).toMatchObject({ suggested_amount: 0.5, suggested_unit: '작은술' })
    expect(out.corrections).toEqual([
      { target: 'ingredients[1].suggested_amount', before: '2큰술', after: null, origin: null, at_seconds: null, method: 'rule' },
    ])
  })

  it('인분도 같은 검사: 없는 인분은 지우고 확인 필요, 다른 출처에 있으면 출처를 고침, 출처 인분이 있으면 덧붙인 인분을 지움', () => {
    const missing = recipe()
    missing.servings = { value: 4, origin: 'description' }
    const a = run(missing)
    expect(a.recipe.servings).toEqual({ value: null, origin: null })
    expect(a.reviews).toEqual([
      { target: 'servings.value', reason: '출처에서 숫자를 찾지 못함', candidates: [{ value: '2인분', origin: 'description', at_seconds: null }] },
    ])
    expect(a.corrections).toEqual([{ target: 'servings.value', before: '4', after: null, origin: null, at_seconds: null, method: 'rule' }])

    const moved = recipe()
    moved.servings = { value: 2, origin: 'caption_auto' }
    expect(run(moved).corrections).toEqual([
      { target: 'servings.origin', before: 'caption_auto', after: 'description', origin: 'description', at_seconds: null, method: 'rule' },
    ])
    expect(run(moved).recipe.servings).toEqual({ value: 2, origin: 'description' })

    const both = recipe()
    both.servings = { value: 2, origin: 'description', suggested: 3 }
    const c = run(both)
    expect(c.recipe.servings).toEqual({ value: 2, origin: 'description', suggested: null })
    expect(c.corrections).toEqual([{ target: 'servings.suggested', before: '3', after: null, origin: null, at_seconds: null, method: 'rule' }])
  })

  it('시간도 같은 검사: 덧붙인 단계의 타이머는 지우고, 근거에 없는 시간은 지우고 확인 필요, "30초"는 30', () => {
    const r = recipe()
    r.steps.push(
      { title: '마무리', body: '불을 끄고 뜸을 들인다.', video_start_seconds: 225, timer_seconds: 30, origin: 'caption_auto' },
      { title: '덧붙임', body: '접시에 담는다.', timer_seconds: 60, origin: 'editor' },
    )
    r.steps[1]!.timer_seconds = 600
    const out = run(r)
    expect(out.recipe.steps.map((s) => s.timer_seconds)).toEqual([undefined, null, 30, null])
    expect(out.recipe.steps[1]!.needs_review).toBe(true)
    expect(out.reviews).toEqual([{ target: 'steps[1].timer_seconds', reason: '출처에서 시간을 찾지 못함', candidates: [] }])
    expect(out.corrections).toEqual([
      { target: 'steps[1].timer_seconds', before: '600', after: null, origin: null, at_seconds: null, method: 'rule' },
      { target: 'steps[3].timer_seconds', before: '60', after: null, origin: null, at_seconds: null, method: 'rule' },
    ])
  })

  it('타이머는 그 단계 동안의 말에서 찾음(다음 단계가 시작하면 끝)', () => {
    const r = recipe()
    r.steps[0]!.timer_seconds = 180 // "3분"은 120초에 나오고, 이 단계(40초)는 다음 단계(120초) 앞에서 끝남 — 앞뒤 10초 안
    expect(run(r).recipe.steps[0]!.timer_seconds).toBe(180)
    const far = recipe()
    far.steps[1]!.video_start_seconds = 90
    far.steps[0]!.timer_seconds = 180 // 이 단계는 90초에 끝남(+10초), "3분"은 120초
    expect(run(far).recipe.steps[0]!.timer_seconds).toBeNull()
  })

  it('정리할 때 켠 needs_review는 확인 필요 항목으로, 확인 필요 항목이 가리키는 재료·단계·원리는 needs_review로', () => {
    const r = recipe()
    r.ingredients[3]!.needs_review = true
    r.steps[0]!.needs_review = true
    r.principles = [
      { title: '단맛 비율', body: '단맛은 1 : 0.8쯤.', origin: 'caption_auto', video_start_seconds: 120, needs_review: true },
      { title: '센 불', body: '물기를 날린다.', origin: 'caption_auto', video_start_seconds: 120 },
    ]
    r.review_items = [
      { target: 'ingredients[2].amount', reason: '설명란과 말이 다름', candidates: [] },
      { target: 'principles[1]', reason: '설명란과 말이 다름', candidates: [] },
    ]
    const out = run(r)
    expect(out.recipe.ingredients[2]!.needs_review).toBe(true)
    expect(out.recipe.principles![1]!.needs_review).toBe(true)
    expect(out.reviews).toEqual([
      { target: 'ingredients[3]', reason: REASONS.flagged, candidates: [] },
      { target: 'steps[0]', reason: REASONS.flagged, candidates: [] },
      { target: 'principles[0]', reason: REASONS.flagged, candidates: [] },
    ])
    expect(out.recipe.review_items).toHaveLength(5)
  })

  it('사람이 고친 값(출처 user)의 분량·인분·타이머는 근거에 없어도 찾지도 고치지도 지우지도 않음', () => {
    const r = recipe()
    r.ingredients[2] = { name: '설탕', amount: 7, unit: '큰술', origin: 'user' }
    r.ingredients[3] = { name: '양파', amount: 3, unit: '개', origin: 'user', at_seconds: 999 }
    r.servings = { value: 4, origin: 'user' }
    r.steps[1] = { ...r.steps[1]!, origin: 'user', timer_seconds: 600 }
    const out = run(r)
    expect(out.recipe.ingredients[2]).toEqual({ name: '설탕', amount: 7, unit: '큰술', origin: 'user' })
    expect(out.recipe.ingredients[3]).toEqual({ name: '양파', amount: 3, unit: '개', origin: 'user', at_seconds: 999 })
    expect(out.recipe.servings).toEqual({ value: 4, origin: 'user' })
    expect(out.recipe.steps[1]!.timer_seconds).toBe(600)
    expect(out.corrections).toEqual([])
    expect(out.reviews).toEqual([])
  })

  it('정리 결과에 이미 있던 고친 곳(자막 낱말)은 남기고 뒤에 더함', () => {
    const r = recipe()
    r.corrections = [{ target: '자막', before: '물려', after: '물엿', origin: 'caption_auto', at_seconds: null, method: 'rule' }]
    r.ingredients[1] = { name: '간장', amount: 3, unit: '큰술', origin: 'caption_auto', at_seconds: 60 }
    const out = run(r)
    expect(out.recipe.corrections!.map((c) => c.target)).toEqual(['자막', 'ingredients[1].origin', 'ingredients[1].at_seconds'])
    expect(out.corrections).toHaveLength(2)
  })

  it('자막이 없는 영상: 말 출처 숫자는 설명란·화면에서 찾고, 없으면 지움', () => {
    const e = evidence({ transcript: null })
    const out = run(recipe(), e)
    expect(out.recipe.ingredients[3]).toMatchObject({ amount: null, needs_review: true })
    expect(out.recipe.steps[1]!.timer_seconds).toBeNull()
  })

  it('고친 곳·확인 필요가 40개를 넘어도 계약을 지킴', () => {
    const r = recipe()
    const names = Array.from({ length: 45 }, (_, i) => `재료${i}`)
    r.ingredients = names.map((name) => ({ name, amount: 9, unit: '큰술', origin: 'description' as const }))
    r.tags.main_details = ['재료0']
    r.steps = [0, 1, 2].map((k) => ({
      title: `단계${k}`, body: '섞는다.', origin: 'description' as const, uses: names.slice(k * 15, k * 15 + 15).map((name) => ({ name })),
    }))
    const out = checkRecipe(r, evidence())
    const p = parseRecipe(out.recipe)
    if (!p.ok) throw new Error(p.errors.join('\n'))
    expect(out.reviews).toHaveLength(45)
    expect(out.recipe.review_items).toHaveLength(40)
    expect(out.recipe.review_items!.at(-1)!.reason).toContain('6곳')
    expect(out.recipe.corrections).toHaveLength(40)
  })
})
