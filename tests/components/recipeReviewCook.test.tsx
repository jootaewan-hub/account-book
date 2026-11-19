// @vitest-environment jsdom
// 레시피 확인 화면과 요리 화면(Task 20). 저장소·시계·wakeLock은 가짜로 둔다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredRecipe } from '../../supabase/functions/_shared/recipeStored'
import { CookMode } from '../../src/recipes/components/CookMode'
import { RecipeBook } from '../../src/recipes/components/RecipeBook'
import { RecipeDetail } from '../../src/recipes/components/RecipeDetail'
import { ReviewSheet } from '../../src/recipes/components/ReviewSheet'
import type { RecipeStore } from '../../src/recipes/lib/store'

const gold = JSON.parse(readFileSync(join(process.cwd(), 'docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json'), 'utf8'))

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'wakeLock')
})

function stored(): StoredRecipe {
  const r = structuredClone(gold)
  const ing = (name: string) => r.ingredients.find((g: { name: string }) => g.name === name)
  Object.assign(ing('간장'), { ingredient_key: 'soy_sauce' })
  Object.assign(ing('설탕'), { ingredient_key: 'sugar' })
  Object.assign(ing('돼지 앞다리살'), { ingredient_key: 'pork_shoulder' })
  r.steps[1].timer_seconds = 120
  r.steps[2].timer_seconds = null
  r.conflicts = [{ about: '고기 양', chosen: '500g', chosen_origin: 'description', other: '600g', other_origin: 'asr', video_start_seconds: 30, note: null }]
  const sugar = r.ingredients.findIndex((g: { name: string }) => g.name === '설탕')
  r.review_items = [
    { target: `ingredients[${sugar}].amount`, reason: '설명란과 말이 달라요', candidates: [{ value: '2', origin: 'asr', at_seconds: 10 }, { value: '3', origin: 'caption_auto', at_seconds: 20 }] },
    { target: 'steps[1].timer_seconds', reason: '시간이 두 번 나와요', candidates: [{ value: '120', origin: 'asr', at_seconds: 70 }] },
    { target: 'conflicts[0]', reason: '두 곳이 엇갈려요', candidates: [] },
  ]
  return { ...r, id: 'r1', difficulty: '보통', difficulty_basis: null, memo: null, rating: null, favorite: false,
    saved_at: '2026-11-19T00:00:00Z', updated_at: '2026-11-19T00:00:00Z' } as StoredRecipe
}

// ── 확인 화면 ─────────────────────────────────────────────────────
function reviewStore() { return { resolveReview: vi.fn(async () => {}) } }
function showReview(store = reviewStore(), onDone = vi.fn(), recipe = stored()) {
  render(<ReviewSheet recipe={recipe} store={store as unknown as RecipeStore} onDone={onDone} />)
  return { store, onDone }
}

describe('확인 화면', () => {
  it('항목을 하나씩 n / N으로 보이고, 까닭·지금 값·후보(값, 출처, 영상 장면)를 적는다', () => {
    showReview()
    const head = screen.getByRole('heading', { level: 2 })
    expect(document.activeElement).toBe(head)
    expect(screen.getByText('1 / 3')).toBeTruthy()
    expect(screen.getByText('설명란과 말이 달라요')).toBeTruthy()
    expect(screen.getByText(/지금 값/).textContent).toContain('2큰술')
    const cands = screen.getAllByRole('listitem')
    expect(cands).toHaveLength(2)
    expect(cands[0].textContent).toContain('2큰술')
    expect(cands[0].textContent).toContain('말 0:10')
    const link = within(cands[1]).getByRole('link', { name: /자동 자막 0:20/ })
    expect(link.getAttribute('href')).toContain('t=20s')
  })
  it('"이 값"은 그 후보로 resolveReview를 부르고 다음 항목으로 넘어간다', async () => {
    const { store } = showReview()
    fireEvent.click(screen.getAllByRole('button', { name: /^이 값/ })[1])
    await screen.findByText('2 / 3')
    expect(store.resolveReview).toHaveBeenCalledWith('r1', 0, { value: '3', origin: 'caption_auto', at_seconds: 20 })
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }))
  })
  it('직접 고치기: 입력을 출처 user, 영상 시각 없음으로 보낸다', async () => {
    const { store } = showReview()
    fireEvent.click(screen.getByRole('button', { name: '직접 고치기' }))
    fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '이 값으로 저장' }))
    await screen.findByText('2 / 3')
    expect(store.resolveReview).toHaveBeenCalledWith('r1', 0, { value: '4', origin: 'user', at_seconds: null })
  })
  it('숫자가 0 이하거나 글자면 저장소를 부르지 않고 그 자리에 알린다', async () => {
    const { store } = showReview()
    fireEvent.click(screen.getByRole('button', { name: '직접 고치기' }))
    for (const bad of ['0', '-1', 'abc', '']) {
      fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: bad } })
      fireEvent.click(screen.getByRole('button', { name: '이 값으로 저장' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/0보다 큰 숫자/)
    }
    expect(store.resolveReview).not.toHaveBeenCalled()
  })
  it('타이머 항목은 초나 분:초로 받아 초로 보낸다', async () => {
    const { store } = showReview()
    fireEvent.click(screen.getAllByRole('button', { name: /^이 값/ })[0])
    await screen.findByText('2 / 3')
    expect(screen.getByText(/지금 값/).textContent).toContain('2:00')
    fireEvent.click(screen.getByRole('button', { name: '직접 고치기' }))
    fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: '1:30' } })
    fireEvent.click(screen.getByRole('button', { name: '이 값으로 저장' }))
    await screen.findByText('3 / 3')
    expect(store.resolveReview).toHaveBeenLastCalledWith('r1', 0, { value: '90', origin: 'user', at_seconds: null })
  })
  it('글 칸은 DB 한도를 넘으면 알린다(재료 이름 60자)', async () => {
    const r = stored()
    r.review_items = [{ target: 'ingredients[0].name', reason: '이름이 둘', candidates: [] }]
    const { store } = showReview(reviewStore(), vi.fn(), r)
    fireEvent.click(screen.getByRole('button', { name: '직접 고치기' }))
    fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: '가'.repeat(61) } })
    fireEvent.click(screen.getByRole('button', { name: '이 값으로 저장' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/60자/)
    expect(store.resolveReview).not.toHaveBeenCalled()
  })
  it('엇갈림 항목은 양쪽을 보이고 "확인함"만 있다. 마지막 뒤 "확인을 마침"이 상세로 돌려보낸다', async () => {
    const { store, onDone } = showReview()
    fireEvent.click(screen.getAllByRole('button', { name: /^이 값/ })[0])
    await screen.findByText('2 / 3')
    fireEvent.click(screen.getAllByRole('button', { name: /^이 값/ })[0])
    await screen.findByText('3 / 3')
    expect(screen.getByText(/500g/)).toBeTruthy()
    expect(screen.getByText(/600g/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '직접 고치기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인함' }))
    const done = await screen.findByRole('button', { name: '확인을 마침' })
    expect(store.resolveReview).toHaveBeenLastCalledWith('r1', 0, { value: '', origin: 'user', at_seconds: null })
    fireEvent.click(done)
    expect(onDone).toHaveBeenCalled()
  })
  it('계량 도구 항목은 네 가지를 버튼으로 고르고, 고르면 상세가 ml를 보인다', async () => {
    const r = stored()
    r.measuring_tool = '확인 못 함'
    r.review_items = [{ target: 'measuring_tool', reason: '스푼인지 숟가락인지 몰라요', candidates: [] }]
    const store = detailStore(r)
    store.resolveReview = vi.fn(async () => { r.measuring_tool = '계량스푼'; r.review_items = [] })
    render(<RecipeDetail store={store as unknown as RecipeStore} recipeId="r1" initialMode="review" onBack={() => {}} />)
    const group = await screen.findByRole('group', { name: '계량 도구 고르기' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['계량스푼', '밥숟가락', '섞어 씀', '확인 못 함'])
    expect(screen.queryByRole('button', { name: '확인함' })).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: '계량스푼' }))
    expect(store.resolveReview).toHaveBeenCalledWith('r1', 0, { value: '계량스푼', origin: 'user', at_seconds: null })
    fireEvent.click(await screen.findByRole('button', { name: '확인을 마침' }))
    await screen.findByRole('group', { name: '인분 고르기' })
    expect(screen.getByText('계량 도구 계량스푼')).toBeTruthy()
    expect(document.body.textContent).toContain('30ml')
  })
  it('저장소가 던지면 알리고 넘어가지 않는다', async () => {
    const store = { resolveReview: vi.fn(async () => { throw new Error('이미 처리된 확인 항목이에요.') }) }
    showReview(store as never)
    fireEvent.click(screen.getAllByRole('button', { name: /^이 값/ })[0])
    expect((await screen.findByRole('alert')).textContent).toContain('이미 처리된')
    expect(screen.getByText('1 / 3')).toBeTruthy()
  })
  it('"AI"·"분석"이라는 말을 쓰지 않는다', () => {
    showReview()
    expect(document.body.textContent).not.toMatch(/AI|분석/)
  })
})

// ── 요리 화면 ─────────────────────────────────────────────────────
const pantry = [
  { ingredient_key: 'soy_sauce', state: 'have' as const },
  { ingredient_key: 'sugar', state: 'always' as const },
  { ingredient_key: 'pork_shoulder', state: 'have' as const },
]
function showCook(opts: { servings?: number | null; store?: { setPantry: ReturnType<typeof vi.fn> }; onExit?: () => void } = {}) {
  const store = opts.store ?? { setPantry: vi.fn(async () => {}) }
  const onExit = opts.onExit ?? vi.fn()
  render(<CookMode recipe={stored()} servings={opts.servings ?? 2} pantry={pantry} store={store as unknown as RecipeStore} onExit={onExit} />)
  return { store, onExit }
}
const stepCount = gold.steps.length

describe('요리 화면: 단계', () => {
  it('한 단계씩 보이고 다음·이전으로 옮긴다. 제목에 포커스가 간다', () => {
    showCook()
    expect(screen.getByText(`1 / ${stepCount}`)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('고기 손질')
    expect(screen.queryByText('양념장 섞기')).toBeNull()
    expect((screen.getByRole('button', { name: '이전' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('양념장 섞기')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }))
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('고기 손질')
  })
  it('그 단계의 재료를 고른 인분의 분량으로 보인다', () => {
    showCook({ servings: 4 })
    const list = screen.getByRole('list', { name: '이 단계 재료' })
    expect(list.textContent).toContain('돼지 앞다리살')
    expect(list.textContent).toContain('원래 500g → 1000g')
    expect(list.textContent).toContain('전부')
  })
  it('기준 인분이면 원래 값을 따로 적지 않는다', () => {
    showCook({ servings: 2 })
    const list = screen.getByRole('list', { name: '이 단계 재료' })
    expect(list.textContent).toContain('500g')
    expect(list.textContent).not.toContain('원래')
  })
  it('넘어가는 신호가 있으면 적는다', () => {
    showCook()
    for (let i = 0; i < stepCount; i++) {
      const cue = gold.steps[i].cue
      if (cue) {
        for (let k = 0; k < i; k++) fireEvent.click(screen.getByRole('button', { name: '다음' }))
        expect(screen.getByText(/넘어가는 신호/).textContent).toContain(cue)
        return
      }
    }
    throw new Error('기준 답안에 신호가 있는 단계가 없다')
  })
  it('재료 체크는 이 화면 안에서만 바뀌고 단계를 옮겨도 남는다', () => {
    showCook()
    const box = within(screen.getByRole('list', { name: '이 단계 재료' })).getByRole('checkbox', { name: /돼지 앞다리살/ }) as HTMLInputElement
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect((within(screen.getByRole('list', { name: '이 단계 재료' })).getByRole('checkbox', { name: /돼지 앞다리살/ }) as HTMLInputElement).checked).toBe(true)
  })
})

describe('요리 화면: 타이머', () => {
  it('timer_seconds가 없는 단계에는 타이머가 없다', () => {
    showCook()
    expect(screen.queryByRole('button', { name: '타이머 시작' })).toBeNull()
  })
  it('있는 단계에서 시작·멈춤·처음으로, 끝나면 알린다', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    showCook()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByTestId('cook-timer').textContent).toBe('2:00')
    fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.getByTestId('cook-timer').textContent).toBe('1:55')
    expect(screen.getByRole('status').textContent).toContain('가는 중')
    fireEvent.click(screen.getByRole('button', { name: '타이머 멈춤' }))
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByTestId('cook-timer').textContent).toBe('1:55')
    fireEvent.click(screen.getByRole('button', { name: '타이머 처음으로' }))
    expect(screen.getByTestId('cook-timer').textContent).toBe('2:00')
    fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(screen.getByTestId('cook-timer').textContent).toBe('0:00')
    expect(screen.getByRole('status').textContent).toContain('시간이 됐어요')
    expect(vibrate).toHaveBeenCalled()
    Reflect.deleteProperty(navigator, 'vibrate')
  })
  it('단계를 옮기면 타이머를 새로 맞춘다', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    showCook()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.click(screen.getByRole('button', { name: '타이머 시작' }))
    act(() => { vi.advanceTimersByTime(3000) })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(screen.getByTestId('cook-timer').textContent).toBe('2:00')
  })
})

describe('요리 화면: 끝', () => {
  const toLast = () => { for (let i = 1; i < stepCount; i++) fireEvent.click(screen.getByRole('button', { name: '다음' })) }
  it('마지막 단계에 가진 재료(있음)만 "다 쓴 재료 끄기"로 나오고, 누르면 setPantry(key, null)', async () => {
    const { store } = showCook()
    expect(screen.queryByText('다 쓴 재료 끄기')).toBeNull()
    toLast()
    const sect = screen.getByRole('group', { name: '다 쓴 재료 끄기' })
    expect(within(sect).queryByRole('button', { name: /설탕/ })).toBeNull() // 늘 있음은 끌 수 없다
    fireEvent.click(within(sect).getByRole('button', { name: /간장 끄기/ }))
    await act(async () => {})
    expect(store.setPantry).toHaveBeenCalledWith('soy_sauce', null)
    expect(within(sect).queryByRole('button', { name: /간장 끄기/ })).toBeNull()
  })
  it('끄기가 실패하면 알리고 단추를 남긴다', async () => {
    const store = { setPantry: vi.fn(async () => { throw new Error('저장하지 못했어요') }) }
    showCook({ store })
    toLast()
    fireEvent.click(screen.getByRole('button', { name: /간장 끄기/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('저장하지 못했어요')
    expect(screen.getByRole('button', { name: /간장 끄기/ })).toBeTruthy()
  })
  it('Esc는 onExit', () => {
    const onExit = vi.fn()
    showCook({ onExit })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onExit).toHaveBeenCalledTimes(1)
  })
  it('마지막 단계의 "요리 끝"과 위쪽 "나가기"는 onExit', () => {
    const onExit = vi.fn()
    showCook({ onExit })
    fireEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    toLast()
    fireEvent.click(screen.getByRole('button', { name: '요리 끝' }))
    expect(onExit).toHaveBeenCalledTimes(2)
  })
})

describe('요리 화면: 화면 켜 두기', () => {
  function fakeLock() {
    const release = vi.fn(async () => {})
    const request = vi.fn(async (_t: string) => ({ release }))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    return { release, request }
  }
  it('열면 요청하고 닫으면 놓는다. 다시 보일 때 다시 요청한다', async () => {
    const { release, request } = fakeLock()
    const view = render(<CookMode recipe={stored()} servings={2} pantry={pantry} store={{} as RecipeStore} onExit={() => {}} />)
    await act(async () => {})
    expect(request).toHaveBeenCalledWith('screen')
    expect(request).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(request).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => {})
    expect(release).toHaveBeenCalledTimes(2)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('보임 신호가 연달아 두 번 와도 받은 잠금을 모두 놓는다', async () => {
    const releases: ReturnType<typeof vi.fn>[] = []
    const pending: ((v: { release: () => Promise<void> }) => void)[] = []
    const request = vi.fn(() => new Promise<{ release: () => Promise<void> }>((res) => { pending.push(res) }))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    const view = render(<CookMode recipe={stored()} servings={2} pantry={pantry} store={{} as RecipeStore} onExit={() => {}} />)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')) })
    expect(request).toHaveBeenCalledTimes(3)
    await act(async () => { pending.forEach((res) => { const release = vi.fn(async () => {}); releases.push(release); res({ release }) }) })
    view.unmount()
    await act(async () => {})
    expect(releases).toHaveLength(3)
    releases.forEach((r) => expect(r).toHaveBeenCalledTimes(1))
  })
  it('API가 없으면 오류 없이 넘어간다', async () => {
    showCook()
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('요청이 거절돼도 오류 화면 없이 넘어간다', async () => {
    const request = vi.fn(async () => { throw new Error('NotAllowedError') })
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
    showCook()
    await act(async () => {})
    expect(request).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('고기 손질')
  })
})

// ── 상세·레시피북에서 들어가는 길 ─────────────────────────────────────
function detailStore(recipe: StoredRecipe) {
  return {
    getRecipe: vi.fn(async () => recipe), listPantry: vi.fn(async () => pantry.map((p) => ({ ...p, source: 'manual' }))),
    resolveReview: vi.fn(async () => {}), setPantry: vi.fn(async () => {}),
  }
}
describe('들어가는 길', () => {
  it('상세에 "확인하기 3"과 "요리 시작"이 있고, 확인을 마치면 상세로 돌아온다', async () => {
    const store = detailStore(stored())
    render(<RecipeDetail store={store as unknown as RecipeStore} recipeId="r1" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '확인하기 3' }))
    expect(screen.getByText('1 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(await screen.findByRole('button', { name: '요리 시작' })).toBeTruthy()
  })
  it('확인할 것이 없으면 "확인하기"가 없다', async () => {
    const r = stored(); r.review_items = []
    render(<RecipeDetail store={detailStore(r) as unknown as RecipeStore} recipeId="r1" onBack={() => {}} />)
    await screen.findByRole('button', { name: '요리 시작' })
    expect(screen.queryByRole('button', { name: /확인하기/ })).toBeNull()
  })
  it('요리 시작은 상세에서 고른 인분으로 연다. 나가면 상세로 돌아온다', async () => {
    const store = detailStore(stored())
    render(<RecipeDetail store={store as unknown as RecipeStore} recipeId="r1" onBack={() => {}} />)
    await screen.findByRole('group', { name: '인분 고르기' })
    fireEvent.click(screen.getByRole('button', { name: '4인분' }))
    fireEvent.click(screen.getByRole('button', { name: '요리 시작' }))
    expect(within(screen.getByRole('list', { name: '이 단계 재료' })).getByText(/원래 500g → 1000g/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '나가기' }))
    expect(screen.queryByRole('dialog', { name: '요리' })).toBeNull()
  })
  it('initialMode=review면 확인 화면부터 연다', async () => {
    render(<RecipeDetail store={detailStore(stored()) as unknown as RecipeStore} recipeId="r1" initialMode="review" onBack={() => {}} />)
    expect(await screen.findByText('1 / 3')).toBeTruthy()
  })
  it('레시피북: 확인 필요 거르기를 켜면 "확인 시작"이 첫 레시피의 확인을 연다', () => {
    const mk = (id: string, status: 'review' | 'saved') => ({ id, title: id, summary: null, status, source_key: 'k', source_url: null, source_title: null, channel: null,
      cuisine: '한식', mains: [], main_details: [], methods: [], occasions: [], difficulty: null, favorite: false, rating: null, memo: null,
      servings: null, servings_origin: null, review_count: status === 'review' ? 2 : 0, added_at: '', updated_at: '' })
    const onReview = vi.fn()
    render(<RecipeBook recipes={[mk('a', 'saved'), mk('b', 'review')]} cookable={null} loading={false} onOpen={() => {}} onReview={onReview} />)
    expect(screen.queryByRole('button', { name: '확인 시작' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '확인 필요 1' }))
    fireEvent.click(screen.getByRole('button', { name: '확인 시작' }))
    expect(onReview).toHaveBeenCalledWith('b')
  })
})
