// 나눠 찍은 긴 영수증 잇기(D-029): 사진이 이어지고 잘린 표시가 있는 조각만 잇고, 날짜가 없는 내역은 옆 사진의 날짜를 쓴다.
import { describe, expect, it } from 'vitest'
import { checkEntries, hasItemMismatch, type CheckedEntry, type Entry } from '../supabase/functions/extract-entries/extract'
import { entryDrafts, mergeBatches, stitchEntries } from '../src/lib/smart'

const item = (name: string, amount: number, quantity = 1) => ({
  name, is_product: true, quantity, unit_price: Math.round(amount / quantity), amount, pack_size: null, pack_unit: null, category: null, image_box: null,
})
const part = (p: Partial<CheckedEntry>): CheckedEntry => ({
  date: '2026-10-25', time: null, merchant: '이마트 분당점', platform: null, amount: 0, is_income: false, is_cancellation: false,
  card_last4: null, payment_hint: null, installment_months: null, category: '장보기', items: [], fuel: null,
  type: 'expense', items_match: null, images: [1], continues_from_previous: false, continues_to_next: false, ...p,
})
const ctx = { today: '2026-10-26', methods: [], categories: [], existing: [], fallbackMethodId: null, fallbackScope: 'shared' as const }

describe('긴 영수증 잇기', () => {
  it('각자 가게·날짜·합계가 있는 영수증 두 장은 사진이 이어져도 잇지 않는다', () => {
    const a = part({ images: [1], amount: 5000, items: [item('우유', 5000)] })
    const b = part({ images: [2], amount: 3000, items: [item('두부', 3000)] })
    expect(stitchEntries([a, b])).toEqual([a, b])
  })

  it('앞 조각 아래가 잘리고 뒤 조각에 머리가 없으면 내역 하나: 날짜·가게는 앞, 합계·카드는 결제 줄이 있는 뒤', () => {
    const a = part({ images: [5], amount: 8000, items: [item('우유', 5000), item('두부', 3000)], continues_to_next: true })
    const b = part({ images: [6], date: null, merchant: '', amount: 12000, items: [item('대파', 4000)], continues_from_previous: true, card_last4: '1234' })
    const [one, ...rest] = stitchEntries([a, b])
    expect(rest).toEqual([])
    expect(one).toMatchObject({ date: '2026-10-25', merchant: '이마트 분당점', amount: 12000, card_last4: '1234', items_match: true, images: [5, 6] })
    expect(one.items.map((it) => it.name)).toEqual(['우유', '두부', '대파'])
    expect(one.notes?.at(-1)).toContain('사진 5~6번을 긴 영수증 한 장으로')
  })

  it('잘린 표시가 없어도 뒤 조각에 머리(날짜·가게)가 없으면 잇는다. 세 조각도 하나로', () => {
    const a = part({ images: [1], amount: 3000, items: [item('우유', 3000)] })
    const b = part({ images: [2], date: null, merchant: '', amount: 2000, items: [item('두부', 2000)] })
    const c = part({ images: [3], date: null, merchant: '', amount: 9000, items: [item('대파', 4000)] })
    const [one, ...rest] = stitchEntries([a, b, c])
    expect(rest).toEqual([])
    expect(one).toMatchObject({ amount: 9000, items_match: true, images: [1, 2, 3] })
  })

  it('결제 줄이 보이는 조각의 합계를 쓰고 더하지 않는다. 겹쳐 찍은 경계 줄은 빼야 합계가 맞을 때만 뺀다', () => {
    const a = part({ images: [1], amount: 8000, items: [item('우유', 5000), item('두부', 3000)], continues_to_next: true })
    const b = part({ images: [2], date: null, merchant: '', amount: 12000, items: [item('두부', 3000), item('대파', 4000)], continues_from_previous: true })
    const [one] = stitchEntries([a, b])
    expect(one.amount).toBe(12000)
    expect(one.items.map((it) => it.name)).toEqual(['우유', '두부', '대파'])
    // 두부를 실제로 두 번 산 경우(합계가 두 번을 포함): 그대로 둔다
    const [twice] = stitchEntries([a, { ...b, amount: 15000 }])
    expect(twice.items.map((it) => it.name)).toEqual(['우유', '두부', '두부', '대파'])
    // 모든 조각이 아래가 잘렸으면(결제 줄이 안 보임) 조각 합
    const [noFooter] = stitchEntries([a, { ...b, continues_to_next: true, amount: 7000, items: [item('대파', 4000), item('양파', 3000)] }])
    expect(noFooter.amount).toBe(15000)
  })

  it('가게·날짜·카드가 다르거나, 사진이 떨어져 있거나, 취소·주유면 잇지 않는다', () => {
    const a = part({ images: [1], amount: 3000, continues_to_next: true })
    const cases: Partial<CheckedEntry>[] = [
      { merchant: '홈플러스' }, { date: '2026-10-24' }, { images: [3] }, { is_cancellation: true },
    ]
    for (const p of cases) expect(stitchEntries([a, part({ images: [2], amount: 5000, ...p })])).toHaveLength(2)
    expect(stitchEntries([{ ...a, card_last4: '1111' }, part({ images: [2], date: null, merchant: '', amount: 5000, card_last4: '2222' })])).toHaveLength(2)
    // (주)·띄어쓰기 차이는 같은 가게
    expect(stitchEntries([{ ...a, merchant: '(주)이마트 분당점' }, part({ images: [2], merchant: '이마트분당점', amount: 5000, continues_from_previous: true })])).toHaveLength(1)
  })

  it('날짜가 안 보이는 내역은 바로 앞 사진(없으면 뒤 사진)의 날짜를 쓴다. 떨어진 사진의 날짜는 쓰지 않는다', () => {
    const a = part({ images: [1], amount: 5000 })
    const b = part({ images: [2], date: null, merchant: '다이소', amount: 3000 }) // 가게가 있어 이어 붙이지는 않음
    const [, got] = stitchEntries([a, b])
    expect(got.date).toBe('2026-10-25')
    expect(got.notes?.[0]).toBe('날짜가 안 보여 바로 앞 사진(1번)의 날짜(10월 25일)로 넣었어요. 다르면 고쳐 주세요.')
    const [first] = stitchEntries([{ ...b, images: [1] }, { ...a, images: [2], date: '2026-10-20' }])
    expect(first.date).toBe('2026-10-20')
    expect(first.notes?.[0]).toContain('바로 뒤 사진(2번)')
    expect(stitchEntries([a, { ...b, images: [4] }])[1].date).toBeNull()
  })

  it('사진 번호가 없는 응답(이 기능 전 서버)은 건드리지 않는다', () => {
    const old = [part({ images: undefined, amount: 1000 }), part({ images: undefined, date: null, merchant: '', amount: 2000 })]
    expect(stitchEntries(old)).toBe(old)
  })

  it('초안: 이은 안내와 옆 사진 날짜 안내가 경고로 보이고, 오늘로 넣었다는 말은 없다', () => {
    const [e] = stitchEntries([part({ images: [1], amount: 3000, continues_to_next: true }), part({ images: [2], date: null, merchant: '', amount: 5000 })])
    const [d] = entryDrafts(e, 0, ctx, false)
    expect(d.date).toBe('2026-10-25')
    expect(d.warnings.some((w) => w.includes('사진 1~2번을 긴 영수증 한 장으로'))).toBe(true)
    expect(d.warnings.some((w) => w.includes('오늘로'))).toBe(false)
  })

  it('5장 묶음을 합칠 때 사진 번호를 전체 기준으로 바꾼다', () => {
    const r = (entries: CheckedEntry[]) => ({ entries, note: null, model: 'm' })
    const out = mergeBatches([r([part({ images: [4, 5] })]), r([part({ images: [1] })])], [5, 5])
    expect(out.entries.map((e) => e.images)).toEqual([[4, 5], [6]])
  })
})

describe('서버 정리 (checkEntries)', () => {
  const raw = (p: Partial<Entry>): Entry => ({
    date: '2026-10-25', time: null, merchant: '이마트', platform: null, amount: 1000, is_income: false, is_cancellation: false,
    card_last4: null, payment_hint: null, installment_months: null, category: null, items: [], fuel: null, ...p,
  })
  const sizes = Array.from({ length: 5 }, () => ({ width: 100, height: 100 }))

  it('사진 번호는 1~받은 장 수의 정수만 겹침 없이 오름차순, 잘림 표시는 없으면 false', () => {
    const [e] = checkEntries({ note: null, entries: [raw({ images: [3, 1, 3, 9, 0, 2.5] })] }, sizes)
    expect(e.images).toEqual([1, 3])
    expect(e).toMatchObject({ continues_from_previous: false, continues_to_next: false })
  })

  it('잘린 조각은 합계에 맞춰 줄 금액을 고치지 않고, 다시 읽기 대상도 아니다', () => {
    const cut = raw({ amount: 1000, items: [item('우유', 2000, 2)], continues_to_next: true })
    const [e] = checkEntries({ note: null, entries: [cut] }, sizes)
    expect(e.items[0].amount).toBe(2000)
    expect(e.price_fixes).toBeUndefined()
    expect(hasItemMismatch([e])).toBe(false)
    const [whole] = checkEntries({ note: null, entries: [{ ...cut, continues_to_next: false, amount: 3000 }] }, sizes)
    expect(hasItemMismatch([whole])).toBe(true)
  })
})
