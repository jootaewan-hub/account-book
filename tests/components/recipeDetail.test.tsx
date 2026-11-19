// @vitest-environment jsdom
// 레시피 상세(Task 19): 인분, 분량, 출처 표시, 용어 풀이, 고친 곳, 가진 재료, 고치기·지우기. 저장소는 가짜로 둔다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredRecipe } from '../../supabase/functions/_shared/recipeStored'
import { RecipeDetail } from '../../src/recipes/components/RecipeDetail'
import type { RecipeStore } from '../../src/recipes/lib/store'
import { amountView, parseQty } from '../../src/recipes/lib/detail'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const gold = JSON.parse(readFileSync(join(process.cwd(), 'docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json'), 'utf8'))

/** 기준 답안 v2를 저장된 레시피로. 시험에 필요한 만큼만 덧붙인다(말 4:02, 용어 풀이, 고친 곳, 사전 키) */
function stored(over: Record<string, unknown> = {}): StoredRecipe {
  const r = structuredClone(gold)
  const ing = (name: string) => r.ingredients.find((g: { name: string }) => g.name === name)
  Object.assign(ing('간장'), { origin: 'asr', at_seconds: 242, ingredient_key: 'soy_sauce' })
  Object.assign(ing('설탕'), { ingredient_key: 'sugar' })
  Object.assign(ing('돼지 앞다리살'), { ingredient_key: 'pork_shoulder' })
  Object.assign(ing('대파'), { ingredient_key: 'green_onion' })
  r.glossary = [
    { term: '미림', body: '요리용 단맛 나는 술이에요.', origin: 'editor', at_seconds: null },
    { term: '핏물', body: '고기에서 나오는 붉은 물이에요.', origin: 'asr', at_seconds: 83 },
  ]
  r.corrections = [
    { target: 'ingredients[1].amount', before: '3', after: '2', origin: 'asr', at_seconds: 100, method: 'rule' },
    { target: 'ingredients[1].origin', before: 'caption_auto', after: 'description', origin: null, at_seconds: null, method: 'compare' },
    { target: 'ingredients[1].at_seconds', before: '55', after: 'null', origin: null, at_seconds: null, method: 'compare' },
    { target: '자막', before: '물려', after: '물엿', origin: 'caption_auto', at_seconds: null, method: 'rule' },
  ]
  return { ...r, id: 'r1', difficulty: '보통', difficulty_basis: { required: 14, steps: 12, heavy: false }, memo: null, rating: null, favorite: false,
    saved_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z', ...over } as StoredRecipe
}

function fake(recipe: StoredRecipe | null = stored(), pantry: { ingredient_key: string; state: 'have' | 'always'; source: string }[] = []) {
  return {
    getRecipe: vi.fn(async (_: string) => recipe),
    listPantry: vi.fn(async () => pantry),
    update: vi.fn(async () => {}),
    editIngredient: vi.fn(async () => {}),
    editStep: vi.fn(async () => {}),
    revertCorrection: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    setPantry: vi.fn(async () => {}),
  }
}
async function show(store: ReturnType<typeof fake>, props: { onBack?: () => void; onMissing?: (r: StoredRecipe) => void } = {}) {
  render(<RecipeDetail store={store as unknown as RecipeStore} recipeId="r1" title="제육" onBack={props.onBack ?? (() => {})} onMissing={props.onMissing} />)
  await screen.findByRole('group', { name: '인분 고르기' })
}
const row = (name: string) => screen.getByText(name, { selector: '.rcp-ing-name, .rcp-ing-name *' }).closest('li') as HTMLElement

describe('인분', () => {
  it('1~8의 여덟 칸이고 기준(덧붙인 인분)이 눌려 있다', async () => {
    await show(fake())
    const picker = screen.getByRole('group', { name: '인분 고르기' })
    const buttons = within(picker).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false', 'false', 'false'])
    expect(screen.getByText('기준 2인분(덧붙임, 영상에 인분 없음)')).toBeTruthy()
  })
  it('출처 인분이 있으면 덧붙임 말 없이 기준 N인분', async () => {
    const r = stored(); r.servings = { value: 3, origin: 'description', basis: null, suggested: null }
    await show(fake(r))
    expect(screen.getByText('기준 3인분')).toBeTruthy()
  })
  it('기준과 같을 때는 원래 값을 따로 보이지 않고, 4인분이면 원래 → 새 값, 약간은 그대로, 덧붙임은 표시를 지킨 채 곱한다', async () => {
    await show(fake())
    expect(row('설탕').textContent).toContain('2큰술')
    expect(row('설탕').textContent).not.toContain('원래')
    fireEvent.click(screen.getByRole('button', { name: '4인분' }))
    expect(row('설탕').textContent).toContain('원래 2큰술 → 4큰술')
    expect(row('돼지 앞다리살').textContent).toContain('원래 500g → 1000g')
    expect(row('후추').textContent).toContain('약간')
    expect(row('후추').textContent).not.toContain('원래')
    expect(row('깻잎').textContent).toContain('약간 (덧붙임 8장쯤 → 16장쯤)')
    expect(row('참기름').textContent).toContain('덧붙임 1작은술쯤 → 2작은술쯤')
    expect(screen.getByRole('button', { name: '4인분' }).getAttribute('aria-pressed')).toBe('true')
  })
  it('인분을 알 수 없으면 고르기 없이 적힌 그대로', async () => {
    const r = stored(); r.servings = { value: null, origin: null, basis: null, suggested: null }
    render(<RecipeDetail store={fake(r) as unknown as RecipeStore} recipeId="r1" onBack={() => {}} />)
    await screen.findByText('후추', { selector: '.rcp-ing-name, .rcp-ing-name *' })
    expect(screen.queryByRole('group', { name: '인분 고르기' })).toBeNull()
  })
})

describe('계량 도구와 난이도', () => {
  it('확인 못 함이면 머리에 알리고 ml를 붙이지 않는다', async () => {
    await show(fake())
    expect(screen.getByText('계량 도구 확인 못 함')).toBeTruthy()
    expect(row('설탕').textContent).not.toContain('ml')
  })
  it('계량스푼이면 큰술에 ml를 붙이고 인분을 바꾸면 ml도 따라간다', async () => {
    await show(fake(stored({ measuring_tool: '계량스푼' })))
    expect(screen.queryByText('계량 도구 확인 못 함')).toBeNull()
    expect(row('설탕').textContent).toContain('2큰술 (30ml)')
    expect(row('돼지 앞다리살').textContent).not.toContain('ml')
    fireEvent.click(screen.getByRole('button', { name: '4인분' }))
    expect(row('설탕').textContent).toContain('원래 2큰술 (30ml) → 4큰술 (60ml)')
  })
  it('¼ 단위로 반올림한 양에서 ml를 셈한다(1큰술, 기준 8인분 → 3인분은 ½큰술 7.5ml)', async () => {
    const r = stored({ measuring_tool: '계량스푼' }); r.servings = { value: 8, origin: 'description', basis: null, suggested: null }
    r.ingredients.find((g) => g.name === '올리고당')!.amount = 1
    await show(fake(r))
    fireEvent.click(screen.getByRole('button', { name: '3인분' }))
    expect(row('올리고당').textContent).toContain('원래 1큰술 (15ml) → ½큰술 (7.5ml)')
  })
  it('밥숟가락이면 ml 없이 기준을 밝힌다', async () => {
    await show(fake(stored({ measuring_tool: '밥숟가락' })))
    expect(row('설탕').textContent).toContain('2큰술 · 밥숟가락 기준')
    expect(row('설탕').textContent).not.toContain('ml')
  })
  it('난이도는 근거 숫자와 함께 한 줄', async () => {
    await show(fake())
    expect(screen.getByText('재료 14 · 단계 12 → 보통')).toBeTruthy()
    cleanup()
    await show(fake(stored({ difficulty_basis: { required: 14, steps: 12, heavy: true } })))
    expect(screen.getByText('재료 14 · 단계 12 → 보통 · 손 많이 감')).toBeTruthy()
  })
})

describe('출처 표시', () => {
  it('말 4:02는 그 지점을 새 탭에서 여는 링크', async () => {
    await show(fake())
    const a = screen.getByRole('link', { name: '말 4:02' })
    expect(a.getAttribute('href')).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs&t=242s')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
  it('설명란 출처는 링크가 아니고, 단계의 영상 시각은 링크', async () => {
    await show(fake())
    expect(screen.queryByRole('link', { name: '설명란' })).toBeNull()
    expect(screen.getAllByText('설명란').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '영상 4:05' }).getAttribute('href')).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs&t=245s')
  })
  it('영상에서 온 글에 든 태그는 글자로만 그린다', async () => {
    const r = stored(); r.ingredients[0].note = '<img src=x onerror=alert(1)>'
    await show(fake(r))
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
  })
})

describe('용어 풀이', () => {
  it('밑줄 친 말을 누르면 풀이와 덧붙임, 영상 시각 출처를 보이고 Esc로 닫으면 포커스가 돌아온다', async () => {
    await show(fake())
    const term = screen.getAllByRole('button', { name: '미림' })[0]
    term.focus()
    fireEvent.click(term)
    const pop = screen.getByRole('dialog', { name: '미림 풀이' })
    expect(within(pop).getByText('요리용 단맛 나는 술이에요.')).toBeTruthy()
    expect(within(pop).getByText('덧붙임')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '미림 풀이' })).toBeNull()
    expect(document.activeElement).toBe(term)

    fireEvent.click(screen.getByRole('button', { name: '핏물' }))
    const p2 = screen.getByRole('dialog', { name: '핏물 풀이' })
    const link = within(p2).getByRole('link', { name: '영상 1:23' })
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs&t=83s')
  })
  it('한 글 덩이에서는 처음 나온 자리만 밑줄', async () => {
    const r = stored(); r.steps[0].body = '핏물을 빼고 핏물을 닦는다'
    await show(fake(r))
    expect(screen.getAllByRole('button', { name: '핏물' })).toHaveLength(1)
  })
})

describe('고친 곳', () => {
  it('출처·시각 짝은 한 줄로 묶고 되돌리기는 값 고침의 순번으로 부른다', async () => {
    const store = fake()
    await show(store)
    const list = screen.getByRole('heading', { name: '고친 곳' }).parentElement as HTMLElement
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    const buttons = within(list).getAllByRole('button', { name: /되돌리기/ })
    expect(buttons).toHaveLength(1) // 자막 고침은 되돌릴 수 없는 종류
    fireEvent.click(buttons[0])
    await act(async () => {})
    expect(store.revertCorrection).toHaveBeenCalledWith('r1', 0)
  })
  it('값 고침이 없고 출처·시각만 바뀐 묶음은 한 줄', async () => {
    const r = stored(); r.corrections = (r.corrections ?? []).slice(1, 3)
    const store = fake(r)
    await show(store)
    const list = screen.getByRole('heading', { name: '고친 곳' }).parentElement as HTMLElement
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(within(list).getByRole('button', { name: /되돌리기/ }))
    await act(async () => {})
    expect(store.revertCorrection).toHaveBeenCalledWith('r1', 0)
  })
})

describe('가진 재료', () => {
  it('N/M과 세지 않은 재료 수, 있음 켜기·끄기', async () => {
    const store = fake(stored(), [{ ingredient_key: 'sugar', state: 'have', source: 'manual' }, { ingredient_key: 'green_onion', state: 'always', source: 'manual' }])
    await show(store)
    expect(screen.getByText('가진 재료 2/4')).toBeTruthy()
    const unmatched = stored().ingredients.filter((g) => !g.optional && !g.ingredient_key).length
    expect(screen.getByText(`사전에 없는 재료 ${unmatched}개는 세지 않았어요`)).toBeTruthy()
    const sugar = screen.getByRole('button', { name: '설탕 있음' })
    expect(sugar.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(sugar)
    await act(async () => {})
    expect(store.setPantry).toHaveBeenCalledWith('sugar', null)
    fireEvent.click(screen.getByRole('button', { name: '간장 있음' }))
    await act(async () => {})
    expect(store.setPantry).toHaveBeenCalledWith('soy_sauce', 'have')
  })
  it('모자란 재료 장보기에 담기는 onMissing에 레시피를 넘기고 모자란 것이 없으면 꺼진다', async () => {
    const onMissing = vi.fn()
    await show(fake(), { onMissing })
    fireEvent.click(screen.getByRole('button', { name: '모자란 재료 장보기에 담기' }))
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(onMissing.mock.calls[0][0].id).toBe('r1')
    cleanup()
    const all = [{ ingredient_key: 'sugar', state: 'have' as const, source: 'm' }, { ingredient_key: 'soy_sauce', state: 'have' as const, source: 'm' },
      { ingredient_key: 'pork_shoulder', state: 'have' as const, source: 'm' }, { ingredient_key: 'green_onion', state: 'have' as const, source: 'm' }]
    await show(fake(stored(), all))
    expect((screen.getByRole('button', { name: '모자란 재료 장보기에 담기' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ml 계산 방어', () => {
  it('읽을 수 없는 양이면 ml 없이 글만 보인다', () => {
    expect(Number.isNaN(parseQty('?'))).toBe(true)
    expect(parseQty('1½')).toBe(1.5)
    const v = amountView({ amount: 1, unit: '큰술' }, Number.NaN, true, '계량스푼')
    expect(v.main).not.toContain('NaNml')
  })
})

describe('고치기와 지우기', () => {
  it('메모만 고치면 바뀐 칸만 보낸다', async () => {
    const store = fake()
    await show(store)
    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    const sheet = screen.getByRole('dialog', { name: '레시피 고치기' })
    fireEvent.change(within(sheet).getByLabelText('재료 2 메모'), { target: { value: '황설탕도 가능' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await act(async () => {})
    expect(store.editIngredient.mock.calls).toEqual([['r1', 1, { note: '황설탕도 가능' }]])
    expect(store.editStep).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })
  it('분류·재료·단계를 고치면 store의 update·editIngredient·editStep을 부른다', async () => {
    const store = fake()
    await show(store)
    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    const sheet = screen.getByRole('dialog', { name: '레시피 고치기' })
    fireEvent.change(within(sheet).getByLabelText('이름'), { target: { value: '바싹 제육볶음' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '볶음' })) // 조리법 끄기
    fireEvent.click(within(sheet).getByRole('button', { name: '구이' })) // 켜기
    fireEvent.click(within(sheet).getByRole('button', { name: '별점 4' }))
    fireEvent.change(within(sheet).getByLabelText('재료 2 분량'), { target: { value: '3' } })
    fireEvent.change(within(sheet).getByLabelText('단계 1 내용'), { target: { value: '앞다리살을 얇게 썬다' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await act(async () => {})
    expect(store.editIngredient).toHaveBeenCalledWith('r1', 1, { amount: 3 })
    expect(store.editStep).toHaveBeenCalledWith('r1', 0, { body: '앞다리살을 얇게 썬다' })
    expect(store.update).toHaveBeenCalledWith('r1', { title: '바싹 제육볶음', methods: ['구이'], rating: 4 })
    expect(screen.queryByRole('dialog', { name: '레시피 고치기' })).toBeNull()
  })
  it('주재료를 모두 끄면 저장할 수 없다', async () => {
    const store = fake()
    await show(store)
    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    const sheet = screen.getByRole('dialog', { name: '레시피 고치기' })
    fireEvent.click(within(sheet).getByRole('button', { name: '돼지고기' }))
    expect((within(sheet).getByRole('button', { name: '저장' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(sheet).getByRole('alert').textContent).toContain('주재료')
    expect(store.update).not.toHaveBeenCalled()
  })
  it('재료 이름을 바꾸면 세부 재료도 새 이름을 따라간다', async () => {
    const store = fake()
    await show(store)
    fireEvent.click(screen.getByRole('button', { name: '고치기' }))
    const sheet = screen.getByRole('dialog', { name: '레시피 고치기' })
    fireEvent.change(within(sheet).getByLabelText('재료 1 이름'), { target: { value: '앞다리살' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '저장' }))
    await act(async () => {})
    expect(store.editIngredient).toHaveBeenCalledWith('r1', 0, { name: '앞다리살' })
    expect(store.update).toHaveBeenCalledWith('r1', { main_details: ['앞다리살'] })
  })
  it('지우기는 확인을 거쳐 archive하고 목록으로 돌아간다', async () => {
    const store = fake()
    const onBack = vi.fn()
    await show(store, { onBack })
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    const dlg = screen.getByRole('alertdialog', { name: '레시피 지우기' })
    expect(store.archive).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByRole('button', { name: '취소' }))
    expect(store.archive).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    fireEvent.click(within(screen.getByRole('alertdialog', { name: '레시피 지우기' })).getByRole('button', { name: '지우기' }))
    await act(async () => {})
    expect(store.archive).toHaveBeenCalledWith('r1')
    expect(onBack).toHaveBeenCalled()
  })
})

describe('불러오기', () => {
  it('읽는 동안 이름이 보이고, 실패하면 알리고 다시 불러오기를 둔다', async () => {
    const store = fake()
    store.getRecipe.mockRejectedValueOnce(new Error('연결이 끊겼어요'))
    render(<RecipeDetail store={store as unknown as RecipeStore} recipeId="r1" title="제육" onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: '제육' })).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('연결이 끊겼어요')
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByRole('group', { name: '인분 고르기' })
  })
  it('화면에 AI·분석이라는 말이 없다', async () => {
    await show(fake())
    expect(document.body.textContent).not.toMatch(/AI|분석/)
  })
})
