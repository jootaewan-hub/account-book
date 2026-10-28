// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { normalizeWish, type Wish, type WishStore } from '../../src/lib/wishes'
import { WishSheet } from '../../src/components/WishSheet'
import { WishList } from '../../src/grocery/components/WishList'

const original: Wish = {
  id: 'one', title: '커피 머신', url: 'https://shop.example/coffee', target_price: 280000, memo: '둘이 보기',
  quote: { price: 350000, source: '다나와', checkedAt: '2026-10-28T10:00:00Z', note: '1개 · 배송비 확인 필요' },
  created_by: 'me', created_at: '2026-10-28T10:00:00Z', bought_at: null,
}
function memory(initial: Wish[] = []) {
  let rows = structuredClone(initial)
  const store: WishStore = {
    list: async () => structuredClone(rows),
    byUrl: async (url) => structuredClone(rows.find((r) => r.url === url) ?? null),
    async save(input, id) {
      const fields = normalizeWish(input)
      if (id) rows = rows.map((r) => r.id === id ? { ...r, ...fields } : r)
      else rows.push({ ...original, ...fields, id: 'new', quote: input.quote })
    },
    async setBought(id, bought) { rows = rows.map((r) => r.id === id ? { ...r, bought_at: bought ? '2026-10-28T11:00:00Z' : null } : r) },
    async remove(id) { rows = rows.filter((r) => r.id !== id) },
    subscribe: () => () => {},
  }
  return store
}
afterEach(cleanup)

it('검색에서 가져온 물건에 목표 가격·메모를 넣어도 보관 당시 가격은 유지한다', async () => {
  const store = memory()
  let done = false
  render(<WishSheet target={{ seed: { ...original, target_price: null, memo: null } }} store={store} onSaved={() => { done = true }} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('목표 가격'), { target: { value: '300000' } })
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: '주말에 고르자' } })
  await waitFor(() => expect((screen.getByRole('button', { name: '보관하기' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '보관하기' }))
  await waitFor(() => expect(done).toBe(true))
  const [saved] = await store.list()
  expect(saved).toMatchObject({ target_price: 300000, memo: '주말에 고르자', quote: { price: 350000, source: '다나와' } })
})

it('같은 링크를 다시 보관하면 기존 물건을 열고 배우자의 목표 가격과 메모를 보존한다', async () => {
  const store = memory([original])
  render(<WishSheet target={{ seed: { ...original, title: '새 검색 이름', target_price: null, memo: null } }} store={store} onSaved={() => {}} onClose={() => {}} />)
  await screen.findByText(/이미 보관한 물건/)
  expect((screen.getByLabelText('목표 가격') as HTMLInputElement).value).toBe('280000')
  expect((screen.getByLabelText('메모') as HTMLTextAreaElement).value).toBe('둘이 보기')
  expect(await store.list()).toHaveLength(1)
})

it('보관함에서 샀어요 표시와 다시 보관을 하고 기존 검색으로 이동할 수 있다', async () => {
  const store = memory([original])
  let searched = ''
  render(<div className="grocery"><WishList store={store} members={[]} version={0} onNew={() => {}} onEdit={() => {}} onSearch={(name) => { searched = name }} /></div>)
  await screen.findByRole('button', { name: '커피 머신' })
  expect(screen.getByText(/^보관 당시/).textContent).toBe('보관 당시 350,000원')
  fireEvent.click(screen.getByRole('button', { name: '가격 다시 찾기' }))
  expect(searched).toBe('커피 머신')
  fireEvent.click(screen.getByRole('button', { name: '샀어요' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '커피 머신' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /산 물건/ }))
  await screen.findByRole('button', { name: '커피 머신' })
  fireEvent.click(screen.getByRole('button', { name: '다시 보관' }))
  await waitFor(async () => expect((await store.list())[0].bought_at).toBeNull())
})

it('검색에서 가져온 상품의 링크를 다른 물건으로 바꾸면 이전 검색 가격을 붙이지 않는다', async () => {
  const store = memory()
  let done = false
  render(<WishSheet target={{ seed: original }} store={store} onSaved={() => { done = true }} onClose={() => {}} />)
  await waitFor(() => expect((screen.getByRole('button', { name: '보관하기' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.change(screen.getByLabelText('물건 이름'), { target: { value: '식탁' } })
  fireEvent.change(screen.getByLabelText('상품 링크'), { target: { value: 'https://shop.example/table' } })
  fireEvent.click(screen.getByRole('button', { name: '보관하기' }))
  await waitFor(() => expect(done).toBe(true))
  expect((await store.list())[0]).toMatchObject({ title: '식탁', url: 'https://shop.example/table', quote: null })
})

it('저장이 실패하면 입력한 이름·메모를 유지하고 오류를 보인다', async () => {
  const store = memory()
  store.save = async () => { throw new Error('연결이 끊겼어요') }
  render(<WishSheet target={{ seed: { title: '', url: null, target_price: null, memo: null, quote: null } }} store={store} onSaved={() => {}} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('물건 이름'), { target: { value: '식탁' } })
  fireEvent.change(screen.getByLabelText('메모'), { target: { value: '나무 색' } })
  fireEvent.click(screen.getByRole('button', { name: '보관하기' }))
  await screen.findByText(/연결이 끊겼어요/)
  expect((screen.getByLabelText('물건 이름') as HTMLInputElement).value).toBe('식탁')
  expect((screen.getByLabelText('메모') as HTMLTextAreaElement).value).toBe('나무 색')
})
