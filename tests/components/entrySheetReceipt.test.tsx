// @vitest-environment jsdom
// 수정 시트의 영수증 사진(D-053): 썸네일·크게 보기, 사진 지우기(두 번 누르기), 다시 읽기로 품목 채우기(이름이 같은 줄은 id 유지, 금액은 안 바꿈), 저장 시 전·후 넘김
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, Transaction } from '../../src/lib/types'

const state = vi.hoisted(() => ({
  files: ['hh/t1/1.jpg', 'hh/t1/2.jpg'],
  removed: [] as string[],
  analyzed: [] as unknown[],
  entries: [] as { amount: number; items: Record<string, unknown>[] }[],
  fail: null as Error | null,
}))

vi.mock('../../src/lib/api', () => ({
  friendlyError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  fetchSaveBatch: async () => [],
}))
vi.mock('../../src/lib/itemImages', () => ({ signedUrls: async () => new Map() }))
vi.mock('../../src/lib/receiptImages', () => ({
  listReceiptImages: async (folder: string) => state.files.filter((f) => f.startsWith(`${folder}/`)),
  downloadReceiptImages: async (paths: string[]) => paths.map((p) => new Blob([p], { type: 'image/jpeg' })),
  removeReceiptImages: async (folder: string) => { state.removed.push(folder) },
  signedReceiptUrls: async (paths: string[]) => new Map(paths.map((p) => [p, `https://x/${p}?t=1`])),
}))
vi.mock('../../src/lib/image', () => ({
  fileToJpeg: async (b: Blob) => ({ media_type: 'image/jpeg', data: `B64:${await b.text()}`, width: 10, height: 20, blob: b, preview: 'blob:p' }),
}))
vi.mock('../../src/lib/smart', () => ({
  SmartError: class SmartError extends Error { constructor(public code: string, message: string) { super(message) } },
  modelLabel: (id: string) => (id ? 'Claude Sonnet 5.5' : null),
  analyzeImages: async (...args: unknown[]) => {
    state.analyzed.push(args)
    if (state.fail) throw state.fail
    return { entries: state.entries, note: null, model: 'claude-sonnet-5-5', failed: [] }
  },
}))

const { EntrySheet } = await import('../../src/components/EntrySheet')
const { makeLookup } = await import('../../src/lib/lookup')

const HH = 'hh'
const categories: Category[] = [{ id: 'c1', household_id: HH, type: 'expense', name: '장보기', sort: 1, archived: false }]
const lookup = makeLookup('me', [{ household_id: HH, user_id: 'me', display_name: '나', role: 'owner', spouse_role: 'husband' }], [], categories)
const item = (id: string, name: string, quantity: number, amount: number, sort: number) => ({
  id, name, quantity, unit_price: Math.round(amount / quantity), amount, pack_size: null, pack_unit: null, image_path: null, sort,
})
const tx: Transaction = {
  id: 't1', household_id: HH, type: 'expense', occurred_on: '2026-11-03', amount: 16000, title: '이마트 수내점', memo: null, category_id: 'c1',
  payment_method_id: null, scope: 'shared', source: 'photo', created_by: 'me', created_at: '2026-11-03T09:00:00Z', recurring_id: null, platform: null,
  merchant: '이마트 수내점', receipt_path: 'hh/t1', fuel: null,
  items: [item('i1', '서울우유 900ml', 2, 4000, 0), item('i2', '쭈꾸미 1팩', 1, 1200, 1)],
}
const fresh = (name: string, amount: number, quantity = 1) => ({
  name, is_product: true, quantity, unit_price: Math.round(amount / quantity), amount, pack_size: null, pack_unit: null, discount: 0, category: '장보기', image_box: null,
})

function open(editing: Transaction = tx) {
  const onSave = vi.fn(async () => {})
  render(<EntrySheet open editing={editing} defaultDate="2026-11-03" today="2026-11-03" lookup={lookup} categories={categories} usage={new Map()}
    onSave={onSave} onDelete={async () => {}} onClose={() => {}} />)
  return { onSave }
}

beforeEach(() => {
  Object.assign(state, { files: ['hh/t1/1.jpg', 'hh/t1/2.jpg'], removed: [], analyzed: [], entries: [], fail: null })
  URL.revokeObjectURL = () => {}
})
afterEach(cleanup)

describe('수정 시트의 영수증 사진', () => {
  it('사진이 있으면 썸네일을 번호 순으로 보이고, 누르면 크게 보기가 열리고 닫힌다', async () => {
    open()
    expect(await screen.findByText('영수증 사진 2장')).toBeTruthy()
    const thumbs = await screen.findAllByRole('button', { name: /^영수증 사진 \d 크게 보기$/ })
    expect(thumbs.map((b) => b.querySelector('img')?.getAttribute('src'))).toEqual(['https://x/hh/t1/1.jpg?t=1', 'https://x/hh/t1/2.jpg?t=1'])
    fireEvent.click(thumbs[1])
    const dialog = screen.getByRole('dialog', { name: '영수증 사진 2' })
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://x/hh/t1/2.jpg?t=1')
    fireEvent.click(screen.getAllByRole('button', { name: '닫기' }).at(-1)!)
    expect(screen.queryByRole('dialog', { name: '영수증 사진 2' })).toBeNull()
  })

  it('사진 경로가 없는 내역에는 칸이 없고, 파일을 못 찾으면 그렇다고 적는다', async () => {
    open({ ...tx, receipt_path: null })
    expect(await screen.findByText('품목 2개')).toBeTruthy()
    expect(screen.queryByText(/^영수증 사진/)).toBeNull()
    cleanup()
    state.files = []
    open()
    expect(await screen.findByText('사진 파일을 찾지 못했어요.')).toBeTruthy()
    expect((screen.getByRole('button', { name: '영수증 다시 읽기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('사진 지우기는 두 번 눌러야 지우고, 지운 뒤에는 칸 대신 지웠다고 적는다', async () => {
    open()
    await screen.findByText('영수증 사진 2장')
    fireEvent.click(screen.getByRole('button', { name: '사진 지우기' }))
    expect(state.removed).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 사진을 지워요' }))
    expect(await screen.findByText('영수증 사진을 지웠어요.')).toBeTruthy()
    expect(state.removed).toEqual(['hh/t1'])
    expect(screen.queryByText(/^영수증 사진 2장/)).toBeNull()
  })

  it('미리보기는 저장할 품목을 바꾸지 않고, 적용해도 일치하지 않는 기존 줄을 남긴다', async () => {
    state.entries = [{ amount: 16000, items: [fresh('국산 대파 1단', 3000), fresh('서울우유 900ml', 4000, 2), fresh('포카칩 오리지널 66g', 1590)] }]
    const { onSave } = open()
    await screen.findByText('영수증 사진 2장')
    fireEvent.click(screen.getByRole('button', { name: '영수증 다시 읽기' }))
    expect(screen.getByRole('button', { name: '영수증 사진 읽는 중…' })).toBeTruthy()
    const apply = await screen.findByRole('button', { name: '읽은 품목 적용' })
    expect(screen.getByText('품목 2개')).toBeTruthy()
    expect(state.analyzed).toEqual([[
      [{ media_type: 'image/jpeg', data: 'B64:hh/t1/1.jpg', width: 10, height: 20 }, { media_type: 'image/jpeg', data: 'B64:hh/t1/2.jpg', width: 10, height: 20 }],
      'receipt', '2026-11-03',
    ]])
    fireEvent.click(apply)
    expect(screen.getByText(/일치하지 않은 기존 품목 1개는 목록 끝에 남겼어요/)).toBeTruthy()
    expect(screen.getByText('품목 4개')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '16,000원 저장하기' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [, id, , change] = onSave.mock.calls[0] as unknown as [unknown, string, unknown, { before: unknown[]; after: { id?: string; name: string }[] }]
    expect(id).toBe('t1')
    expect(change.before).toEqual(tx.items)
    expect(change.after.map((a) => [a.name, a.id ?? null])).toEqual([
      ['국산 대파 1단', null], ['서울우유 900ml', 'i1'], ['포카칩 오리지널 66g', null], ['쭈꾸미 1팩', 'i2'],
    ])
  })

  it.each([
    { total: 5200, batch: null, message: /일치하는 결제를 하나로 고를 수 없어요/ },
    { total: 4000, batch: 'split-1', message: /상품별로 나눠 저장한 내역이에요/ },
  ])('금액이 다르거나 나눈 영수증이면 미리보기만 한다 ($total, $batch)', async ({ total, batch, message }) => {
    state.entries = [{ amount: total, items: [fresh('서울우유 900ml', 4000, 2), fresh('쭈꾸미 1팩', 1200)] }]
    const { onSave } = open({ ...tx, amount: 4000, save_batch: batch, items: [tx.items![0]] })
    await screen.findByText('영수증 사진 2장')
    fireEvent.click(screen.getByRole('button', { name: '영수증 다시 읽기' }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.getByText(/결제 .*원 · 품목 2개/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '읽은 품목 적용' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '4,000원 저장하기' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [, , , change] = onSave.mock.calls[0] as unknown as [unknown, unknown, unknown, { after: unknown[] }]
    expect(change.after).toEqual([tx.items![0]])
  })

  it('적용 전 수동 편집을 되돌리기로 복원하고, 읽기에 실패하면 까닭을 보인다', async () => {
    state.entries = [{ amount: 16000, items: [fresh('국산 대파 1단', 3000)] }]
    open()
    await screen.findByText('영수증 사진 2장')
    fireEvent.click(screen.getAllByRole('button', { name: '고치기' })[0])
    fireEvent.change(screen.getByRole('textbox', { name: '1번째 품목 이름' }), { target: { value: '우유 (수동 수정)' } })
    fireEvent.click(screen.getByRole('button', { name: '영수증 다시 읽기' }))
    fireEvent.click(await screen.findByRole('button', { name: '읽은 품목 적용' }))
    fireEvent.click(screen.getByRole('button', { name: '적용 전 품목으로 되돌리기' }))
    expect((screen.getByRole('textbox', { name: '1번째 품목 이름' }) as HTMLInputElement).value).toBe('우유 (수동 수정)')
    state.fail = new Error('분석 서버에 연결하지 못했어요.')
    fireEvent.click(screen.getByRole('button', { name: '영수증 다시 읽기' }))
    expect(await screen.findByText('분석 서버에 연결하지 못했어요.')).toBeTruthy()
  })
})
