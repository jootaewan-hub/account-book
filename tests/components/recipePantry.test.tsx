// @vitest-environment jsdom
// 가진 재료 화면과 모자란 재료 시트(Task 21). 저장소는 가짜로 두되 가진 재료·장보기 상태는 실제로 바뀌게 한다.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MissingSheet } from '../../src/recipes/components/MissingSheet'
import { PantryScreen } from '../../src/recipes/components/PantryScreen'
import type { RecipeStore } from '../../src/recipes/lib/store'

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

type P = { ingredient_key: string; state: 'have' | 'always'; source: string }
const DICT = [
  { id: 'salt', name: '소금', aliases: ['꽃소금'], category: '장·양념·소스' },
  { id: 'egg', name: '계란', aliases: ['달걀'], category: '유제품·난류' },
  { id: 'tofu', name: '두부', aliases: [], category: '기타' },
  { id: 'onion', name: '양파', aliases: [], category: '채소' },
]
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

function fake(over: { pantry?: P[]; dict?: typeof DICT; bought?: { name: string; bought_at: string | null }[]; grocery?: string[]; added?: number } = {}) {
  const pantry: P[] = [...(over.pantry ?? [])]
  const grocery = [...(over.grocery ?? [])]
  const store = {
    listPantry: vi.fn(async () => pantry.map((p) => ({ ...p }))),
    listDict: vi.fn(async () => over.dict ?? DICT),
    recentBought: vi.fn(async () => over.bought ?? []),
    activeGroceryNames: vi.fn(async () => [...grocery]),
    setPantry: vi.fn(async (key: string, state: 'have' | 'always' | null, source: 'manual' | 'grocery' = 'manual') => {
      const i = pantry.findIndex((p) => p.ingredient_key === key)
      if (state === null) { if (i >= 0) pantry.splice(i, 1); return }
      if (i >= 0) pantry[i] = { ingredient_key: key, state, source }
      else pantry.push({ ingredient_key: key, state, source })
    }),
    addMissingToGrocery: vi.fn(async (recipe: { ingredients: { name: string; ingredient_key?: string | null }[] }, keys: string[]) => {
      const names = recipe.ingredients.filter((g) => g.ingredient_key && keys.includes(g.ingredient_key)).map((g) => g.name)
      grocery.push(...names)
      return over.added ?? names.length
    }),
  }
  return { store, pantry, grocery }
}
const asStore = (f: ReturnType<typeof fake>) => f.store as unknown as RecipeStore

async function showPantry(f: ReturnType<typeof fake>, onBack = () => {}) {
  render(<PantryScreen store={asStore(f)} onBack={onBack} />)
  await screen.findByRole('heading', { name: '가진 재료' })
  await act(async () => {})
}

describe('가진 재료 화면', () => {
  it('늘 있음과 지금 있음 두 묶음에 사전 이름으로 보이고, 사전에 없는 키는 키 그대로 보인다', async () => {
    const f = fake({ pantry: [
      { ingredient_key: 'salt', state: 'always', source: 'manual' },
      { ingredient_key: 'egg', state: 'have', source: 'manual' },
      { ingredient_key: 'mystery', state: 'have', source: 'manual' },
    ] })
    await showPantry(f)
    const always = screen.getByRole('region', { name: '늘 있음' })
    const have = screen.getByRole('region', { name: '지금 있음' })
    expect(within(always).getByText('소금')).toBeTruthy()
    expect(within(always).queryByText('계란')).toBeNull()
    expect(within(have).getByText('계란')).toBeTruthy()
    expect(within(have).getByText('mystery')).toBeTruthy()
  })

  it('비어 있으면 묶음마다 비었다고 알린다', async () => {
    await showPantry(fake())
    expect(within(screen.getByRole('region', { name: '늘 있음' })).getByText('아직 없어요')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: '지금 있음' })).getByText('아직 없어요')).toBeTruthy()
  })

  it('끄기를 누르면 그 재료를 가진 재료에서 뺀다', async () => {
    const f = fake({ pantry: [{ ingredient_key: 'egg', state: 'have', source: 'manual' }] })
    await showPantry(f)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '계란 끄기' })) })
    expect(f.store.setPantry).toHaveBeenCalledWith('egg', null)
    expect(f.pantry).toEqual([])
    expect(screen.queryByRole('button', { name: '계란 끄기' })).toBeNull()
  })

  it('이름이나 동의어로 사전에서 찾아 상태를 골라 더한다. 이미 있는 재료는 찾아도 나오지 않는다', async () => {
    const f = fake({ pantry: [{ ingredient_key: 'egg', state: 'have', source: 'manual' }] })
    await showPantry(f)
    const box = screen.getByRole('searchbox', { name: '재료 찾기' })
    fireEvent.change(box, { target: { value: '달걀' } })
    expect(screen.queryByRole('button', { name: '계란 늘 있음에 넣기' })).toBeNull()
    expect(screen.getByText('이미 가진 재료에 있어요')).toBeTruthy()
    fireEvent.change(box, { target: { value: '트러플' } })
    expect(screen.getByText('찾는 재료가 사전에 없어요')).toBeTruthy()
    fireEvent.change(box, { target: { value: '꽃 소금' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '소금 늘 있음에 넣기' })) })
    expect(f.store.setPantry).toHaveBeenCalledWith('salt', 'always', 'manual')
    expect(within(screen.getByRole('region', { name: '늘 있음' })).getByText('소금')).toBeTruthy()
    expect((box as HTMLInputElement).value).toBe('')
  })

  it('지금 있음으로도 넣을 수 있다', async () => {
    const f = fake()
    await showPantry(f)
    fireEvent.change(screen.getByRole('searchbox', { name: '재료 찾기' }), { target: { value: '두부' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '두부 지금 있음에 넣기' })) })
    expect(f.pantry).toEqual([{ ingredient_key: 'tofu', state: 'have', source: 'manual' }])
  })

  it('사전이 비어 있으면 레시피를 담을 때 늘어난다고 알린다', async () => {
    await showPantry(fake({ dict: [] }))
    expect(screen.getByText(/사전이 아직 비어 있어요/)).toBeTruthy()
    expect(screen.queryByRole('searchbox', { name: '재료 찾기' })).toBeNull()
  })

  it('장보기에서 산 것 가운데 사전과 맞는 것은 맨 위에서 묻고, 누르기 전에는 넣지 않는다', async () => {
    const f = fake({ bought: [
      { name: '달걀', bought_at: daysAgo(2) },
      { name: '두부', bought_at: daysAgo(3) },
      { name: '우유', bought_at: daysAgo(1) }, // 사전에 없음
      { name: '양파', bought_at: daysAgo(30) }, // 14일 밖
    ], pantry: [{ ingredient_key: 'tofu', state: 'have', source: 'manual' }] })
    await showPantry(f)
    const banner = screen.getByRole('region', { name: '장보기에서 산 것' })
    expect(within(banner).getByText('장보기에서 산 것 1개를 넣을까요?')).toBeTruthy()
    expect(within(banner).getByText('계란')).toBeTruthy()
    expect(f.store.setPantry).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(banner).getByRole('button', { name: '넣기' })) })
    expect(f.store.setPantry).toHaveBeenCalledTimes(1)
    expect(f.store.setPantry).toHaveBeenCalledWith('egg', 'have', 'grocery')
    expect(f.pantry.find((p) => p.ingredient_key === 'egg')).toEqual({ ingredient_key: 'egg', state: 'have', source: 'grocery' })
    expect(screen.queryByRole('region', { name: '장보기에서 산 것' })).toBeNull()
    expect(within(screen.getByRole('region', { name: '지금 있음' })).getByText('계란')).toBeTruthy()
  })

  it('넣을 만한 것이 없으면 묻는 칸이 없다', async () => {
    await showPantry(fake({ bought: [{ name: '우유', bought_at: daysAgo(1) }] }))
    expect(screen.queryByRole('region', { name: '장보기에서 산 것' })).toBeNull()
  })

  it('장보기 기록을 읽지 못해도 화면은 쓸 수 있다', async () => {
    const f = fake({ pantry: [{ ingredient_key: 'salt', state: 'always', source: 'manual' }] })
    f.store.recentBought.mockRejectedValueOnce(new Error('network'))
    await showPantry(f)
    expect(screen.getByText('소금')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '장보기에서 산 것' })).toBeNull()
  })

  it('불러오기에 실패하면 안내와 다시 불러오기를 보인다', async () => {
    const f = fake()
    f.store.listPantry.mockRejectedValueOnce(new Error('연결이 끊겼어요'))
    render(<PantryScreen store={asStore(f)} onBack={() => {}} />)
    expect(await screen.findByText('연결이 끊겼어요')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' })) })
    expect(screen.getByRole('region', { name: '늘 있음' })).toBeTruthy()
  })

  it('끄기가 실패하면 그 자리에 알리고 목록은 그대로다', async () => {
    const f = fake({ pantry: [{ ingredient_key: 'egg', state: 'have', source: 'manual' }] })
    f.store.setPantry.mockRejectedValueOnce(new Error('권한이 없어요'))
    await showPantry(f)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '계란 끄기' })) })
    expect(screen.getByRole('alert').textContent).toContain('권한이 없어요')
    expect(screen.getByText('계란')).toBeTruthy()
  })

  it('뒤로 단추가 돌아간다', async () => {
    const onBack = vi.fn()
    await showPantry(fake(), onBack)
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(onBack).toHaveBeenCalled()
  })
})

const recipe = {
  id: 'r1',
  ingredients: [
    { name: '두부', ingredient_key: 'tofu', optional: false },
    { name: '대파', ingredient_key: 'green_onion', optional: false },
    { name: '소금', ingredient_key: 'salt', optional: false }, // 가짐
    { name: '후추', ingredient_key: 'pepper', optional: true }, // 없어도 됨
    { name: '미림', ingredient_key: null, optional: false }, // 사전에 없음
    { name: '참기름', ingredient_key: 'sesame_oil', optional: false }, // 이미 장보기에 있음
  ],
}
const asRecipe = () => recipe as unknown as Parameters<typeof MissingSheet>[0]['recipe']

async function showSheet(f: ReturnType<typeof fake>, onClose = () => {}) {
  render(<MissingSheet recipe={asRecipe()} store={asStore(f)} onClose={onClose} />)
  await screen.findByRole('dialog', { name: '모자란 재료' })
  await screen.findByRole('button', { name: /장보기에 \d+개 담기/ })
}
const sheetFake = (over: Parameters<typeof fake>[0] = {}) => fake({ pantry: [{ ingredient_key: 'salt', state: 'always', source: 'manual' }], grocery: ['참기름'], ...over })

describe('모자란 재료 시트', () => {
  it('모자란 필수 재료가 체크된 채로 보이고, 가진 것과 없어도 되는 것은 빠지며, 이미 장보기에 있는 것은 "이미 있음"이다', async () => {
    await showSheet(sheetFake())
    const tofu = screen.getByRole('checkbox', { name: '두부' }) as HTMLInputElement
    const leek = screen.getByRole('checkbox', { name: '대파' }) as HTMLInputElement
    expect(tofu.checked).toBe(true)
    expect(leek.checked).toBe(true)
    expect(screen.queryByText('소금')).toBeNull()
    expect(screen.queryByText('후추')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: '참기름' })).toBeNull()
    const oil = screen.getByText('참기름').closest('li') as HTMLElement
    expect(within(oil).getByText('이미 있음')).toBeTruthy()
    expect(screen.getByRole('button', { name: '장보기에 2개 담기' })).toBeTruthy()
  })

  it('사전에 없는 재료는 비교하지 못했다고 한 줄로 알린다', async () => {
    await showSheet(sheetFake())
    expect(screen.getByText(/미림/).textContent).toContain('사전에 없어 가진 재료와 비교하지 못했어요')
  })

  it('체크를 빼면 개수가 줄고 그 재료는 담지 않는다. 0개면 단추가 꺼진다', async () => {
    const f = sheetFake()
    await showSheet(f)
    fireEvent.click(screen.getByRole('checkbox', { name: '대파' }))
    expect(screen.getByRole('button', { name: '장보기에 1개 담기' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '장보기에 1개 담기' })) })
    expect(f.store.addMissingToGrocery).toHaveBeenCalledWith(recipe, ['tofu'])
  })

  it('0개이면 담기 단추가 꺼진다', async () => {
    await showSheet(sheetFake())
    fireEvent.click(screen.getByRole('checkbox', { name: '두부' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '대파' }))
    expect((screen.getByRole('button', { name: '장보기에 0개 담기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('담으면 돌려받은 개수로 "장보기에 N개 담았어요"를 보이고, 담은 것은 이미 있음으로 바뀐다', async () => {
    const f = sheetFake({ added: 1 }) // 두 개를 골랐지만 한 개만 새로 들어간 경우
    await showSheet(f)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '장보기에 2개 담기' })) })
    expect(f.store.addMissingToGrocery).toHaveBeenCalledWith(recipe, ['tofu', 'green_onion'])
    expect(screen.getByRole('status').textContent).toBe('장보기에 1개 담았어요')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(within(screen.getByText('두부').closest('li') as HTMLElement).getByText('이미 있음')).toBeTruthy()
  })

  it('담지 못하면 그 자리에 알리고 체크는 그대로다', async () => {
    const f = sheetFake()
    f.store.addMissingToGrocery.mockRejectedValueOnce(new Error('장보기 목록에 쓰지 못했어요'))
    await showSheet(f)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '장보기에 2개 담기' })) })
    expect(screen.getByRole('alert').textContent).toContain('장보기 목록에 쓰지 못했어요')
    expect((screen.getByRole('checkbox', { name: '두부' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: '장보기에 2개 담기' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('모자란 재료가 없으면 그렇다고 알린다', async () => {
    const f = fake({ pantry: ['tofu', 'green_onion', 'salt', 'sesame_oil'].map((k) => ({ ingredient_key: k, state: 'have' as const, source: 'manual' })) })
    render(<MissingSheet recipe={asRecipe()} store={asStore(f)} onClose={() => {}} />)
    expect(await screen.findByText('모자란 필수 재료가 없어요')).toBeTruthy()
  })

  it('읽지 못하면 안내와 다시 불러오기를 보이고, 닫기는 된다', async () => {
    const f = sheetFake()
    f.store.activeGroceryNames.mockRejectedValueOnce(new Error('장보기 목록을 읽지 못했어요'))
    const onClose = vi.fn()
    render(<MissingSheet recipe={asRecipe()} store={asStore(f)} onClose={onClose} />)
    expect(await screen.findByText('장보기 목록을 읽지 못했어요')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' })) })
    expect(screen.getByRole('checkbox', { name: '두부' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Esc로 닫힌다', async () => {
    const onClose = vi.fn()
    await showSheet(sheetFake(), onClose)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
