// @vitest-environment jsdom
// 캡처로 일정 넣기 시트(D-039): 캡처를 고르고 읽으면 초안이 보이고, 이미 있는 일정은 빼 두며, 고친 값으로 한 번에 넣는다.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckedEvent } from '../../supabase/functions/extract-entries/eventCheck'
import type { CalEvent, EventInput } from '../../src/lib/types'

const state = vi.hoisted(() => ({
  events: [] as CheckedEvent[],
  note: null as string | null,
  existing: [] as CalEvent[],
  inserted: [] as EventInput[][],
  fail: null as Error | null,
  fetchRange: null as [string, string] | null,
}))

vi.mock('../../src/lib/image', () => ({
  fileToJpeg: async (f: File) => ({ media_type: 'image/jpeg', data: 'AAAA', width: 10, height: 10, blob: f, preview: `blob:${f.name}` }),
}))
vi.mock('../../src/lib/smart', () => ({
  SmartError: class SmartError extends Error {},
  modelLabel: (id: string) => (id ? 'Claude Haiku 5.5' : null),
  invoke: async () => {
    if (state.fail) throw state.fail
    return { events: state.events, note: state.note, model: 'claude-haiku-5-5' }
  },
}))
vi.mock('../../src/lib/api', () => ({
  friendlyError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  fetchEvents: async (_h: string, from: string, to: string) => { state.fetchRange = [from, to]; return state.existing },
  insertEvents: async (_h: string, list: EventInput[]) => { state.inserted.push(list) },
}))

const { EventCaptureSheet } = await import('../../src/components/EventCaptureSheet')
const { CalendarView } = await import('../../src/components/CalendarView')
const { makeLookup } = await import('../../src/lib/lookup')

beforeEach(() => {
  Object.assign(state, { events: [], note: null, existing: [], inserted: [], fail: null, fetchRange: null })
  URL.revokeObjectURL = () => {}
})
afterEach(cleanup)

const checked = (p: Partial<CheckedEvent>): CheckedEvent => ({
  title: '을지로 정육식당 저녁 예약', date: '2026-11-15', time: '18:30', memo: '4명 · 예약번호 A1234', notice: 'booking', warnings: [], images: [1], ...p,
})

async function readCapture() {
  const onSaved = vi.fn(async () => {})
  const onManual = vi.fn()
  render(<EventCaptureSheet open today="2026-11-02" householdId="h" onSaved={onSaved} onManual={onManual} onClose={() => {}} />)
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], 'cap.png', { type: 'image/png' })] } })
  fireEvent.click(await screen.findByRole('button', { name: '캡처 1장 읽기' }))
  return { onSaved, onManual }
}

describe('캡처로 일정 넣기 시트', () => {
  it('읽은 일정을 보여 주고, 고친 값으로 넣은 뒤 가장 이른 날짜를 알린다', async () => {
    state.events = [checked({}), checked({ title: '치과 진료', date: '2026-11-03', time: null, memo: null })]
    const { onSaved } = await readCapture()
    expect(await screen.findByDisplayValue('을지로 정육식당 저녁 예약')).toBeTruthy()
    expect(screen.getByText('11월 15일 일요일 18:30')).toBeTruthy()
    expect(state.fetchRange).toEqual(['2026-11-03', '2026-11-15'])
    // 치과는 하루 종일로 읽혔다: 시간 칸이 꺼져 있다
    const allDay = screen.getAllByLabelText('하루 종일 (시간 없이)') as HTMLInputElement[]
    expect(allDay.map((c) => c.checked)).toEqual([false, true])
    fireEvent.change(screen.getByDisplayValue('치과 진료'), { target: { value: '치과 스케일링' } })
    fireEvent.click(screen.getByRole('button', { name: '일정 2건 넣기' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2, '2026-11-03'))
    const none = { place: null, address: null, lat: null, lng: null, scope: 'shared' }
    expect(state.inserted).toEqual([[
      { title: '을지로 정육식당 저녁 예약', date: '2026-11-15', time: '18:30', memo: '4명 · 예약번호 A1234', ...none },
      { title: '치과 스케일링', date: '2026-11-03', time: null, memo: null, ...none },
    ]])
  })

  it('이미 달력에 있는 일정은 빼 두고 까닭을 보인다. 체크를 켜면 넣을 수 있다', async () => {
    state.events = [checked({})]
    state.existing = [{ id: 'e1', household_id: 'h', date: '2026-11-15', time: '18:30', title: '정육식당', memo: null, place: null, address: null, lat: null, lng: null, scope: 'shared' }]
    await readCapture()
    expect(await screen.findByText('같은 날 "정육식당"(18:30) 일정이 이미 있어서 빼 두었어요.')).toBeTruthy()
    expect((screen.getByRole('button', { name: '넣을 일정을 고르세요' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '을지로 정육식당 저녁 예약 넣기' }))
    expect(screen.getByRole('button', { name: '일정 1건 넣기' })).toBeTruthy()
  })

  it('날짜를 못 읽은 일정은 날짜를 넣기 전까지 넣지 않는다', async () => {
    state.events = [checked({ date: null, warnings: ['날짜를 읽지 못했어요. 날짜를 넣어 주세요.'] })]
    const { onSaved } = await readCapture()
    expect(await screen.findByText('날짜 없음')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '일정 1건 넣기' }))
    expect(await screen.findByText('"을지로 정육식당 저녁 예약"의 날짜를 넣어 주세요.')).toBeTruthy()
    expect(state.inserted).toEqual([])
    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-11-20' } })
    fireEvent.click(screen.getByRole('button', { name: '일정 1건 넣기' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1, '2026-11-20'))
  })

  it('장소·주소·좌표를 함께 넣고, 주소를 고치면 좌표를 지운다(옛 위치로 길찾기가 열리지 않게)', async () => {
    state.events = [checked({ place: '더그랜드롯데 서울 라세느', address: '서울 중구 을지로 30 본관 1층', lat: 37.5653, lng: 126.981 })]
    const { onSaved } = await readCapture()
    expect(await screen.findByDisplayValue('더그랜드롯데 서울 라세느')).toBeTruthy()
    expect((screen.getByRole('link', { name: /대중교통 길찾기/ }) as HTMLAnchorElement).href).toContain('/p/directions/-/126.981,37.5653,')
    fireEvent.change(screen.getByLabelText('주소 (선택)'), { target: { value: '서울 중구 을지로 30' } })
    expect(screen.queryByRole('link', { name: /길찾기/ })).toBeNull()
    expect(screen.getByRole('link', { name: /네이버 지도에서 찾기/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '일정 1건 넣기' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(state.inserted[0][0]).toMatchObject({ place: '더그랜드롯데 서울 라세느', address: '서울 중구 을지로 30', lat: null, lng: null })
  })

  it('일정이 없는 캡처면 서버가 준 까닭을 보이고 고르기 화면에 남는다. 오류도 그 자리에서 보인다', async () => {
    state.note = '영수증으로 보여요. 일정이 없어요.'
    await readCapture()
    expect(await screen.findByText('영수증으로 보여요. 일정이 없어요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '캡처 1장 읽기' })).toBeTruthy()
    cleanup()
    state.fail = new Error('잠시 후 다시 시도해 주세요.')
    await readCapture()
    expect(await screen.findByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
  })
})

describe('문자 붙여넣기(D-046)', () => {
  async function readText(value: string) {
    const onSaved = vi.fn(async () => {})
    render(<EventCaptureSheet open today="2026-11-02" householdId="h" onSaved={onSaved} onManual={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '문자 붙여넣기' }))
    fireEvent.change(screen.getByLabelText('붙여넣을 문자'), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: '읽고 일정 넣기' }))
    return { onSaved }
  }

  it('확인할 것이 없으면 확인 화면 없이 바로 넣는다', async () => {
    state.events = [checked({ title: '추계 심포지엄', date: '2026-11-21', time: '09:00', memo: '09:00~17:00 · 사전등록, 평점 6점', place: '코엑스 401호', address: null })]
    const { onSaved } = await readText('[○○학회] 추계 심포지엄 11/21(토) 09:00 코엑스 401호')
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1, '2026-11-21'))
    expect(state.inserted[0][0]).toMatchObject({ title: '추계 심포지엄', date: '2026-11-21', time: '09:00', place: '코엑스 401호', scope: 'shared' })
    expect(screen.queryByRole('button', { name: /일정 \d+건 넣기/ })).toBeNull()
  })

  it('확인 문장(지난 날짜 등)이나 같은 일정이 있으면 바로 넣지 않고 확인 화면', async () => {
    state.events = [checked({ title: '호텔 체크인', date: '2026-10-30', warnings: ['지난 날짜예요(2026년 10월 30일). 맞는지 확인해 주세요.'] })]
    const { onSaved } = await readText('○○호텔 예약 확정 10/30 체크인 15:00')
    expect(await screen.findByText(/확인할 것이 있어 바로 넣지 않았어요/)).toBeTruthy()
    expect(screen.getByText('지난 날짜예요(2026년 10월 30일). 맞는지 확인해 주세요.')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
    expect(state.inserted).toEqual([])
  })
})

describe('달력의 캡처로 일정 넣기 버튼', () => {
  it('고른 날 아래 일정·기념일 넣기 옆에 있고, 누르면 시트를 연다', () => {
    const onCapture = vi.fn()
    render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-02" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])}
      annivs={[]} events={[]} onSelect={() => {}} onPlan={() => {}} onCapture={onCapture} onJump={() => {}} onEdit={() => {}} />)
    expect(screen.getByRole('button', { name: '일정·기념일 넣기' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '캡처·문자로 일정 넣기' }))
    expect(onCapture).toHaveBeenCalledOnce()
  })

  it('장소가 있는 일정은 장소 줄을 누르면 네이버 지도(좌표가 있으면 길찾기, 없으면 검색)를 새 탭으로 연다', () => {
    const ev = (p: Partial<import('../../src/lib/types').CalEvent>) => ({ id: 'e', household_id: 'h', date: '2026-11-11', time: '18:00', title: '라세느 예약', memo: null,
      place: null, address: null, lat: null, lng: null, scope: 'shared' as const, ...p })
    const onPlan = vi.fn()
    render(<CalendarView ym="2026-11" today="2026-11-02" sel="2026-11-11" cur={[]} prev={[]} lookup={makeLookup('u1', [], [], [])} annivs={[]}
      events={[ev({ id: 'a', place: '더그랜드롯데 서울 라세느', lat: 37.5653, lng: 126.981 }), ev({ id: 'b', title: '치과', time: '10:00', address: '서울 서초구 강남대로 1' }), ev({ id: 'c', title: '모임' })]}
      onSelect={() => {}} onPlan={onPlan} onJump={() => {}} onEdit={() => {}} />)
    const route = screen.getByRole('link', { name: '더그랜드롯데 서울 라세느 길찾기, 네이버 지도' }) as HTMLAnchorElement
    expect(route.href).toContain('https://map.naver.com/p/directions/-/126.981,37.5653,')
    expect(route.target).toBe('_blank')
    expect(route.rel).toContain('noopener')
    expect((screen.getByRole('link', { name: '서울 서초구 강남대로 1 지도 검색, 네이버 지도' }) as HTMLAnchorElement).href).toContain('/p/search/')
    expect(screen.getAllByRole('link')).toHaveLength(2) // 장소가 없는 '모임'은 링크가 없다
    fireEvent.click(screen.getByRole('button', { name: /^라세느 예약\s*18:00$/ }))
    expect(onPlan).toHaveBeenCalledWith({ kind: 'event', event: expect.objectContaining({ id: 'a' }) })
  })
})
