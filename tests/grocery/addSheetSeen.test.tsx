// @vitest-environment jsdom
// 담기 시트의 지난 기록(D-042): 적은 품목마다 기록에 적힌 이름·값·날짜·어디서를 보이고, 기록을 못 읽어도 담기는 된다.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AddSheet from '../../src/grocery/components/AddSheet'
import type { ListStore } from '../../src/grocery/lib/store'
import type { SeenRecord } from '../../src/grocery/lib/seen'

afterEach(cleanup)

const rec = (p: Partial<SeenRecord> & Pick<SeenRecord, 'name'>): SeenRecord => ({
  source: 'receipt', date: '2026-10-14', where: '이마트 분당점', quantity: 1, amount: 2980, unitPrice: null, packSize: null, packUnit: null, ...p,
})
const storeWith = (seenRecords: () => Promise<SeenRecord[]>) => ({ seenRecords, readPhoto: vi.fn() }) as unknown as ListStore

function open(store: ListStore) {
  const onAdd = vi.fn(async () => {})
  render(<AddSheet onAdd={onAdd} onClose={() => {}} store={store} />)
  return { onAdd }
}

describe('담기 시트의 지난 기록', () => {
  it('품목마다 같은 단위에서 가장 싼 줄을 먼저, 나머지는 펼쳐서 보인다(출처·날짜 포함)', async () => {
    open(storeWith(async () => [
      rec({ name: '서울우유 1L', amount: 2980 }),
      rec({ source: 'order', where: '쿠팡', date: '2026-10-20', name: '매일우유 900ml', quantity: 2, amount: 5560 }),
      rec({ name: '우유식빵', amount: 3800, where: '파리바게뜨' }),
    ]))
    fireEvent.change(screen.getByLabelText('살 것'), { target: { value: '우유\n양파' } })
    const block = await screen.findByLabelText('우유 지난 기록')
    expect(block.textContent).toContain('지난 기록 2건')
    expect(block.textContent).toContain('서울우유 1L')
    expect(block.textContent).toContain('100ml당 가장 쌈')
    expect(block.textContent).toContain('2,980원100ml당 298원')
    expect(block.textContent).toContain('10월 14일 이마트 분당점 영수증')
    expect(block.textContent).not.toContain('우유식빵')
    expect(block.textContent).not.toContain('매일우유')
    fireEvent.click(screen.getByRole('button', { name: /나머지 1건 보기/ }))
    expect(block.textContent).toContain('2개 5,560원100ml당 309원')
    expect(block.textContent).toContain('10월 20일 쿠팡 주문')
    // 기록이 없는 품목(양파)은 아무것도 붙지 않는다
    expect(screen.queryByLabelText('양파 지난 기록')).toBeNull()
  })

  it('기록을 못 읽으면 짧게 알리고 담기는 그대로 된다', async () => {
    const { onAdd } = open(storeWith(async () => { throw new Error('offline') }))
    fireEvent.change(screen.getByLabelText('살 것'), { target: { value: '우유' } })
    expect(await screen.findByText('지난 기록을 불러오지 못했어요. 담기는 그대로 돼요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /1\s*개 담기/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce())
  })
})
