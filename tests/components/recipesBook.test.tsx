// @vitest-environment jsdom
// 레시피 탭(Task 18): 담기·북마크릿·처리 줄·거르기·찾기. 저장소는 가짜로 둔다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecipesTab } from '../../src/recipes/RecipesTab'
import { originLabel, videoAt } from '../../src/recipes/lib/display'
import type { InboxJob, RecipeStore, RecipeSummary, WorkerStatus } from '../../src/recipes/lib/store'

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/') })

const NOW = Date.now()
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

function recipe(over: Partial<RecipeSummary>): RecipeSummary {
  return { id: 'r1', title: '기사식당 제육볶음', summary: null, status: 'saved', source_key: 'youtube:aaaaaaaaaaa', source_url: null, source_title: null, channel: null,
    cuisine: '한식', mains: ['돼지고기'], main_details: ['앞다리살'], methods: ['볶음'], occasions: ['반찬'], difficulty: '보통', favorite: false, rating: null, memo: null,
    servings: null, servings_origin: null, review_count: 0, added_at: ago(60), updated_at: ago(60), ...over }
}
const job = (over: Partial<InboxJob>): InboxJob => ({ id: 'j1', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', source_key: 'youtube:BBBBBBBBBBB', state: 'waiting',
  stage: null, fail_reason: null, recipe_id: null, attempts: 0, added_at: ago(0), ...over })

function fake(over: { recipes?: RecipeSummary[]; jobs?: InboxJob[]; worker?: WorkerStatus | null; cookable?: { recipe_id: string; have: number; need: number; missing: string[] }[] } = {}) {
  const store = {
    listRecipes: vi.fn(async () => over.recipes ?? []),
    listInbox: vi.fn(async () => over.jobs ?? []),
    workerStatus: vi.fn(async () => over.worker ?? null),
    cookable: vi.fn(async () => over.cookable ?? []),
    addUrl: vi.fn(async (_: string) => ({ kind: 'added' as const })),
    retry: vi.fn(async (_: string) => 'retried' as const),
    dismiss: vi.fn(async (_: string) => {}),
    subscribe: vi.fn(() => () => {}),
  }
  return store
}
async function open(store: ReturnType<typeof fake>) {
  render(<RecipesTab householdId="h" userId="u" store={store as unknown as RecipeStore} />)
  await screen.findByRole('textbox', { name: '유튜브 주소' })
  await act(async () => {})
}

describe('담기', () => {
  it('?add= 로 열면 물어보고, 담기를 누르기 전에는 addUrl을 부르지 않는다', async () => {
    window.history.replaceState(null, '', '/?tab=recipes&add=' + encodeURIComponent('https://youtu.be/AkX6uA4BaDs'))
    const store = fake()
    await open(store)
    expect(screen.getByText('이 영상을 담을까요?')).toBeTruthy()
    expect(screen.getByText('https://www.youtube.com/watch?v=AkX6uA4BaDs')).toBeTruthy()
    expect(store.addUrl).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('region', { name: '담기 확인' })).getByRole('button', { name: '담기' }))
    await act(async () => {})
    expect(store.addUrl).toHaveBeenCalledWith('https://youtu.be/AkX6uA4BaDs')
    expect(window.location.search).toBe('')
    expect(screen.queryByText('이 영상을 담을까요?')).toBeNull()
  })
  it('닫기는 담지 않고 주소 줄에서 tab·add를 지운다', async () => {
    window.history.replaceState(null, '', '/?tab=recipes&add=' + encodeURIComponent('https://youtu.be/AkX6uA4BaDs'))
    const store = fake()
    await open(store)
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(store.addUrl).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    expect(screen.queryByText('이 영상을 담을까요?')).toBeNull()
  })
  it('유튜브가 아닌 add 주소는 담을 수 없다고 알린다', async () => {
    window.history.replaceState(null, '', '/?tab=recipes&add=' + encodeURIComponent('https://example.com/x'))
    await open(fake())
    expect(screen.getByText('지금은 유튜브 영상과 쇼츠만 담을 수 있어요')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '담기 확인' })).queryByRole('button', { name: '담기' })).toBeNull()
  })
  it('담기 칸에 붙여넣고 담기를 누르면 addUrl', async () => {
    const store = fake()
    await open(store)
    fireEvent.change(screen.getByRole('textbox', { name: '유튜브 주소' }), { target: { value: 'https://youtu.be/AkX6uA4BaDs' } })
    fireEvent.click(screen.getByRole('button', { name: '담기' }))
    await act(async () => {})
    expect(store.addUrl).toHaveBeenCalledWith('https://youtu.be/AkX6uA4BaDs')
    expect(screen.getByText('담았어요')).toBeTruthy()
  })
  it('결과별 글: exists_job, invalid, exists_recipe는 그 레시피를 연다', async () => {
    const store = fake({ recipes: [recipe({ id: 'r9', title: '이미 있는 레시피' })] })
    await open(store)
    const input = screen.getByRole('textbox', { name: '유튜브 주소' })
    const submit = async (v: string) => { fireEvent.change(input, { target: { value: v } }); fireEvent.click(screen.getByRole('button', { name: '담기' })); await act(async () => {}) }
    store.addUrl.mockResolvedValueOnce({ kind: 'exists_job' } as never)
    await submit('https://youtu.be/AkX6uA4BaDs')
    expect(screen.getByText('이미 담겨 있어요')).toBeTruthy()
    store.addUrl.mockResolvedValueOnce({ kind: 'invalid' } as never)
    await submit('https://example.com')
    expect(screen.getByText('지금은 유튜브 영상과 쇼츠만 담을 수 있어요')).toBeTruthy()
    store.addUrl.mockResolvedValueOnce({ kind: 'exists_recipe', id: 'r9' } as never)
    await submit('https://youtu.be/AkX6uA4BaDs')
    expect(screen.getByRole('region', { name: '레시피 상세' }).textContent).toContain('이미 있는 레시피')
  })
  it('PC·맥에서 담기: 북마크릿 글과 복사 단추', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await open(fake())
    expect(screen.queryByText(/^javascript:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'PC·맥에서 담기' }))
    const expected = `javascript:location.href='${window.location.origin}${import.meta.env.BASE_URL}?tab=recipes&add='+encodeURIComponent(location.href)`
    expect(screen.getByText(expected)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '복사' }))
    await act(async () => {})
    expect(writeText).toHaveBeenCalledWith(expected)
    expect(screen.getByText('복사했어요')).toBeTruthy()
  })
})

describe('처리 줄', () => {
  it('처리 중 줄은 stage 글을 그대로 보인다', async () => {
    await open(fake({ jobs: [job({ state: 'processing', stage: '화면 글자 읽는 중' })] }))
    expect(screen.getByText('화면 글자 읽는 중')).toBeTruthy()
  })
  it('대기 2분 넘고 처리기 확인이 12분 넘으면 맥이 켜지면 처리돼요와 마지막 확인', async () => {
    await open(fake({ jobs: [job({ added_at: ago(3) })], worker: { last_seen_at: ago(13), version: '1' } }))
    expect(screen.getByText('맥이 켜지면 처리돼요')).toBeTruthy()
    expect(screen.getByText('맥 처리기 마지막 확인: 13분 전')).toBeTruthy()
  })
  it('대기 중인 일 옆에는 마지막 확인을 늘 보이고, 알림 간격(5분)의 두 배 안이면 꺼졌다고 하지 않는다(M7)', async () => {
    await open(fake({ jobs: [job({ added_at: ago(30) })], worker: { last_seen_at: ago(6), version: '1' } }))
    expect(screen.getByText('맥 처리기 마지막 확인: 6분 전')).toBeTruthy()
    expect(screen.queryByText('맥이 켜지면 처리돼요')).toBeNull()
  })
  it('실패 줄은 치울 수 있다(지우지 않고 목록에서 뺀다)', async () => {
    const store = fake({ jobs: [job({ id: 'jf', state: 'failed', fail_reason: '비공개 영상이에요' })] })
    await open(store)
    store.listInbox.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'youtu.be/BBBBBBBBBBB 목록에서 치우기' }))
    await act(async () => {})
    expect(store.dismiss).toHaveBeenCalledWith('jf')
    expect(screen.queryByText('비공개 영상이에요')).toBeNull()
  })
  it('사본을 쓰지 못하고 있으면 처리 줄이 없어도 한 줄로 알린다(I7)', async () => {
    await open(fake({ worker: { last_seen_at: ago(1), version: '1', export_issue: '옵시디언 폴더에 쓰지 못했어요', export_checked_at: ago(3) } }))
    expect(screen.getByText('사본: 옵시디언 폴더에 쓰지 못했어요 (3분 전 확인)')).toBeTruthy()
    cleanup()
    await open(fake({ worker: { last_seen_at: ago(1), version: '1', export_issue: null, export_checked_at: ago(3) } }))
    expect(screen.queryByText(/^사본:/)).toBeNull()
  })
  it('처리기를 본 적 없으면 확인 기록 없음', async () => {
    await open(fake({ jobs: [job({ added_at: ago(3) })], worker: null }))
    expect(screen.getByText('맥이 켜지면 처리돼요')).toBeTruthy()
    expect(screen.getByText('맥 처리기 마지막 확인: 확인 기록 없음')).toBeTruthy()
  })
  it('방금 담았거나 처리기가 최근에 살아 있으면 안내하지 않는다', async () => {
    await open(fake({ jobs: [job({ added_at: ago(1) }), job({ id: 'j2', added_at: ago(10) })], worker: { last_seen_at: ago(1), version: '1' } }))
    expect(screen.queryByText('맥이 켜지면 처리돼요')).toBeNull()
  })
  it('실패 줄은 까닭과 다시 하기, 이미 담긴 일이면 이미 담겨 있어요', async () => {
    const store = fake({ jobs: [job({ id: 'jf', state: 'failed', fail_reason: '자막과 음성을 받지 못했어요' })] })
    await open(store)
    expect(screen.getByText('자막과 음성을 받지 못했어요')).toBeTruthy()
    store.retry.mockResolvedValueOnce('exists_job' as never)
    fireEvent.click(screen.getByRole('button', { name: '다시 하기' }))
    await act(async () => {})
    expect(store.retry).toHaveBeenCalledWith('jf')
    expect(screen.getByText('이미 담겨 있어요')).toBeTruthy()
  })
})

describe('실패한 일 다시 하기', () => {
  it('그 사이 레시피북에 들어온 글이면 그 레시피를 연다', async () => {
    const store = fake({ recipes: [recipe({ id: 'r9', title: '이미 있는 레시피' })], jobs: [job({ id: 'jf', state: 'failed', fail_reason: '자막과 음성을 받지 못했어요' })] })
    await open(store)
    store.retry.mockResolvedValueOnce({ kind: 'exists_recipe', id: 'r9' } as never)
    fireEvent.click(screen.getByRole('button', { name: '다시 하기' }))
    await act(async () => {})
    expect(store.retry).toHaveBeenCalledWith('jf')
    expect(screen.getByRole('region', { name: '레시피 상세' }).textContent).toContain('이미 있는 레시피')
  })
})

describe('거르기와 찾기', () => {
  const recipes = [
    recipe({ id: 'a', title: '기사식당 제육볶음', favorite: true }),
    recipe({ id: 'b', title: '두부조림', cuisine: '한식', mains: ['두부·콩'], main_details: ['단단한 두부'], methods: ['조림'], difficulty: '쉬움', occasions: ['반찬'] }),
    recipe({ id: 'c', title: '까르보나라', cuisine: '양식', mains: ['면'], main_details: ['스파게티면'], methods: ['볶음'], difficulty: '어려움', occasions: ['한그릇'] }),
    recipe({ id: 'd', title: '확인할 것', status: 'review', review_count: 2 }),
  ]
  const titles = () => screen.queryAllByRole('button', { name: /^(기사식당|두부|까르보|확인할)/ }).map((b) => b.querySelector('b')?.textContent)
  it('요리 종류·주재료·조리법·난이도·상황·즐겨찾기로 거른다', async () => {
    await open(fake({ recipes }))
    expect(titles()).toHaveLength(4)
    fireEvent.change(screen.getByRole('combobox', { name: '요리 종류' }), { target: { value: '양식' } })
    expect(titles()).toEqual(['까르보나라'])
    fireEvent.change(screen.getByRole('combobox', { name: '요리 종류' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '주재료' }), { target: { value: '두부·콩' } })
    expect(titles()).toEqual(['두부조림'])
    fireEvent.change(screen.getByRole('combobox', { name: '주재료' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '조리법' }), { target: { value: '볶음' } })
    expect(titles()).toEqual(['기사식당 제육볶음', '까르보나라', '확인할 것'])
    fireEvent.change(screen.getByRole('combobox', { name: '난이도' }), { target: { value: '어려움' } })
    expect(titles()).toEqual(['까르보나라'])
    fireEvent.change(screen.getByRole('combobox', { name: '조리법' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '난이도' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('combobox', { name: '상황' }), { target: { value: '한그릇' } })
    expect(titles()).toEqual(['까르보나라'])
    fireEvent.change(screen.getByRole('combobox', { name: '상황' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '즐겨찾기' }))
    expect(titles()).toEqual(['기사식당 제육볶음'])
  })
  it('지금 만들 수 있음·1~2개만 사면 됨은 cookable 결과로 거르고 가진 재료 수를 보인다', async () => {
    const store = fake({ recipes, cookable: [
      { recipe_id: 'a', have: 3, need: 3, missing: [] },
      { recipe_id: 'b', have: 3, need: 4, missing: ['두부'] },
    ] })
    await open(store)
    fireEvent.click(screen.getByRole('button', { name: '지금 만들 수 있음' }))
    expect(titles()).toEqual(['기사식당 제육볶음'])
    fireEvent.click(screen.getByRole('button', { name: '1~2개만 사면 됨' }))
    expect(titles()).toEqual(['두부조림'])
    expect(screen.getByRole('button', { name: /두부조림/ }).textContent).toContain('가진 재료 3/4')
    expect(store.cookable).toHaveBeenCalledWith(2)
  })
  it('재료 목록의 이름으로도 찾는다(M8)', async () => {
    await open(fake({ recipes: [recipe({ id: 'a', title: '기사식당 제육볶음', ingredient_names: ['돼지 앞다리살', '깻잎'] }), recipe({ id: 'b', title: '두부조림', ingredient_names: ['두부'] })] }))
    fireEvent.change(screen.getByRole('searchbox', { name: '레시피 찾기' }), { target: { value: '깻잎' } })
    expect(titles()).toEqual(['기사식당 제육볶음'])
  })
  it('이름·재료로 찾는다', async () => {
    await open(fake({ recipes }))
    fireEvent.change(screen.getByRole('searchbox', { name: '레시피 찾기' }), { target: { value: '스파게티' } })
    expect(titles()).toEqual(['까르보나라'])
    fireEvent.change(screen.getByRole('searchbox', { name: '레시피 찾기' }), { target: { value: '제육' } })
    expect(titles()).toEqual(['기사식당 제육볶음'])
  })
  it('보관한 레시피는 목록에 없고, 확인 필요 개수를 보인다', async () => {
    await open(fake({ recipes: [...recipes, recipe({ id: 'z', title: '보관한 것', status: 'archived' })] }))
    expect(screen.queryByText('보관한 것')).toBeNull()
    expect(screen.getByRole('button', { name: /확인 필요 1/ })).toBeTruthy()
  })
  it('빈 레시피북은 한 문장으로 안내한다', async () => {
    await open(fake())
    expect(screen.getByText('아직 담은 레시피가 없어요. 위 칸에 유튜브 주소를 붙여 넣어 담아 보세요.')).toBeTruthy()
  })
})

describe('cookable을 못 읽을 때', () => {
  it('레시피·처리 줄·담기 칸은 그대로 보이고 두 칩과 가진 재료 수만 빠진다', async () => {
    const store = fake({ recipes: [recipe({ title: '두부조림' })], jobs: [job({ state: 'processing', stage: '저장 중' })] })
    store.cookable.mockRejectedValue(new Error('schema'))
    await open(store)
    expect(screen.getByRole('button', { name: /두부조림/ }).textContent).not.toContain('가진 재료')
    expect(screen.getByText('저장 중')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '지금 만들 수 있음' })).toBeNull()
    expect(screen.queryByRole('button', { name: '1~2개만 사면 됨' })).toBeNull()
  })
})

describe('글과 탭', () => {
  it('화면 어디에도 AI·분석 글자가 없다', async () => {
    window.history.replaceState(null, '', '/?tab=recipes&add=' + encodeURIComponent('https://youtu.be/AkX6uA4BaDs'))
    const store = fake({ recipes: [recipe({})], jobs: [job({ added_at: ago(5) }), job({ id: 'p', state: 'processing', stage: '레시피 정리 중' }), job({ id: 'f', state: 'failed', fail_reason: '실패' })], worker: null })
    await open(store)
    fireEvent.click(screen.getByRole('button', { name: 'PC·맥에서 담기' }))
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/AI|분석/)
  })
  it('아래 탭 줄은 일곱 칸이다', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    expect(app.match(/<button className="tab" /g)).toHaveLength(7)
    expect(css).toMatch(/\.tabbar \.wrap \{[^}]*repeat\(7, minmax\(0, 1fr\)\)/)
    expect(app).toMatch(/get\('tab'\)[\s\S]{0,200}'recipes'/)
  })
})

describe('출처 글과 영상 시각', () => {
  it('originLabel', () => {
    expect(originLabel('description', null)).toBe('설명란')
    expect(originLabel('asr', 242)).toBe('말 4:02')
    expect(originLabel('screen', 14)).toBe('화면 0:14')
    expect(originLabel('caption_manual', 70)).toBe('작성자 자막 1:10')
    expect(originLabel('user', null)).toBe('직접 고침')
    expect(originLabel('editor', null)).toBe('덧붙임')
    expect(originLabel('asr', null)).toBe('말')
    expect(originLabel('screen', 3725)).toBe('화면 1:02:05')
  })
  it('videoAt은 그 시각의 유튜브 주소', () => {
    expect(videoAt('https://youtu.be/AkX6uA4BaDs', 242)).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs&t=242s')
    expect(videoAt('https://www.youtube.com/shorts/AkX6uA4BaDs', 5.9)).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs&t=5s')
    expect(videoAt('https://example.com/a', 5)).toBe('https://example.com/a')
  })
})

beforeEach(() => { vi.useRealTimers() })

describe('가진 재료와 모자란 재료(Task 21)', () => {
  const pantryFake = () => ({
    ...fake({ recipes: [recipe({})], cookable: [{ recipe_id: 'r1', have: 1, need: 2, missing: ['tofu'] }] }),
    listPantry: vi.fn(async () => [] as { ingredient_key: string; state: 'have' | 'always'; source: string }[]),
    listDict: vi.fn(async () => [{ id: 'egg', name: '계란', aliases: [], category: '유제품·난류' }]),
    recentBought: vi.fn(async () => []),
    setPantry: vi.fn(async () => {}),
  })
  it('레시피북의 "가진 재료"가 화면을 열고, 뒤로 가면 레시피북을 다시 읽는다', async () => {
    const store = pantryFake()
    await open(store)
    const before = store.cookable.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '가진 재료' }))
    expect(await screen.findByRole('heading', { name: '가진 재료' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '유튜브 주소' })).toBeNull()
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    await screen.findByRole('textbox', { name: '유튜브 주소' })
    await act(async () => {})
    expect(store.cookable.mock.calls.length).toBeGreaterThan(before)
  })
})
