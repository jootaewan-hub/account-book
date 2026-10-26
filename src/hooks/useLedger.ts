import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { fetchEvents, fetchHouseholdBundle, fetchRecurring, fetchTwoMonths, friendlyError } from '../lib/api'
import { addMonths, monthRange } from '../lib/dates'
import { sb } from '../lib/supabase'
import type { Anniversary, CalEvent, Category, Household, Member, PaymentMethod, Recurring, Transaction } from '../lib/types'

export interface LedgerMeta {
  household: Household | null | undefined // undefined: 불러오는 중, null: 아직 가구 없음
  members: Member[]
  methods: PaymentMethod[]
  categories: Category[]
  anniversaries: Anniversary[]
  error: string | null
  reload: () => Promise<void>
}

export function useLedgerMeta(): LedgerMeta {
  const [state, setState] = useState<Omit<LedgerMeta, 'reload'>>({
    household: undefined, members: [], methods: [], categories: [], anniversaries: [], error: null,
  })
  // 설정 저장과 실시간 알림이 겹쳐 두 번 읽을 때, 늦게 온 옛 응답이 새 값을 덮지 않게 요청 번호를 센다
  const req = useRef(0)
  const reload = useCallback(async () => {
    const id = ++req.current
    try {
      const b = await fetchHouseholdBundle()
      if (id === req.current) setState({ ...b, error: null })
    } catch (e) {
      // 못 불러온 것과 가구가 없는 것(null)은 다르다. 처음이면 undefined로 두어 오류 화면이 나온다
      if (id === req.current) setState((s) => ({ ...s, error: friendlyError(e) }))
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { ...state, reload }
}

const NO_ROWS: Transaction[] = []

/**
 * 보고 있는 달과 그 전달의 내역. 달을 넘기면 새 달의 응답이 올 때까지 txs는 비어 있고 loading이 true다
 * (이전 달 내역으로 "지난달보다" 비교가 틀리게 나오지 않게). version은 다시 읽기에 성공할 때마다 오른다 —
 * 배열이 새로 만들어졌는지 대신 이 숫자를 "내역이 바뀌었다"는 신호로 쓴다.
 */
export function useMonthTransactions(householdId: string | undefined, ym: string) {
  const [data, setData] = useState<{ ym: string; rows: Transaction[]; version: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const req = useRef(0)

  const reload = useCallback(async () => {
    if (!householdId) return
    const id = ++req.current
    try {
      const rows = await fetchTwoMonths(householdId, ym)
      if (id === req.current) { setData((d) => ({ ym, rows, version: (d?.version ?? 0) + 1 })); setError(null) }
    } catch (e) {
      if (id === req.current) setError(friendlyError(e))
    }
  }, [householdId, ym])

  useEffect(() => { void reload() }, [reload])
  const current = data && data.ym === ym ? data : null
  // 이 달 내역을 아직 못 받았을 때만 불러오는 중(못 불러왔으면 오류 줄이 대신 보인다). 같은 달을 다시 읽는 동안은 있던 내역을 그대로 보인다
  return { txs: current?.rows ?? NO_ROWS, version: current?.version ?? 0, loading: current === null && !error, error, reload }
}

/** 보고 있는 달부터 다음 달 말까지의 일정 (다가오는 일정 표시용으로 한 달 더) */
export function useMonthEvents(householdId: string | undefined, ym: string) {
  const [events, setEvents] = useState<CalEvent[]>([])
  const req = useRef(0)
  const reload = useCallback(async () => {
    if (!householdId) return
    const id = ++req.current
    try {
      const rows = await fetchEvents(householdId, monthRange(ym).start, monthRange(addMonths(ym, 1)).end)
      if (id === req.current) setEvents(rows)
    } catch { /* 일정을 못 불러와도 가계부는 그대로 쓴다 */ }
  }, [householdId, ym])
  useEffect(() => { void reload() }, [reload])
  return { events, reload }
}

const NO_RECURRING: Recurring[] = []

/**
 * 달력의 고정지출 예정분(D-030)에 쓰는 반복 항목. recurring 표는 실시간 알림에 없어서
 * 켜질 때(달력 탭으로 올 때, 고정 탭에서 고친 뒤 포함)와 화면에 다시 나타날 때 새로 읽는다.
 */
export function useRecurringList(householdId: string | undefined, active: boolean) {
  const [list, setList] = useState<Recurring[]>(NO_RECURRING)
  const req = useRef(0)
  const reload = useCallback(async () => {
    if (!householdId) return
    const id = ++req.current
    try {
      const rows = await fetchRecurring(householdId)
      if (id === req.current) setList(rows)
    } catch { /* 못 읽으면 예정 금액만 빠지고 가계부는 그대로 쓴다 */ }
  }, [householdId])
  useEffect(() => {
    if (!active) return
    void reload()
    const onVisible = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active, reload])
  return list
}

/**
 * 상대가 입력하면 바로 보이도록 Realtime 변경을 구독한다.
 * iOS 홈 화면 앱은 백그라운드에서 연결이 끊길 수 있어, 다시 화면에 나타나면 새로 불러온다.
 */
export function useLiveUpdates(householdId: string | undefined, onTx: () => void, onMeta: () => void, onEvents: () => void = () => {}) {
  // 콜백이 바뀌어도 구독을 다시 만들지 않고 늘 최신 것을 부른다
  const txEvent = useEffectEvent(onTx)
  const metaEvent = useEffectEvent(onMeta)
  const evEvent = useEffectEvent(onEvents)

  useEffect(() => {
    if (!householdId) return
    // 여러 행이 한꺼번에 바뀌면(상품별로 나눈 영수증 저장 등) 250ms 안의 알림을 한 번으로 묶는다. 종류마다 타이머를 따로 둔다
    const timers: ReturnType<typeof setTimeout>[] = []
    const debounced = (fn: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      return () => { clearTimeout(timer); timer = setTimeout(fn, 250); timers.push(timer) }
    }
    const tx = debounced(() => txEvent())
    const meta = debounced(() => metaEvent())
    const ev = debounced(() => evEvent())
    const filter = `household_id=eq.${householdId}`
    const channel = sb()
      .channel(`ledger-${householdId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter }, tx)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions', filter }, tx)
      // 삭제 이벤트에는 필터가 적용되지 않아 id만 받고 새로 불러온다
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'transactions' }, tx)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_methods', filter }, meta)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter }, meta)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter }, meta)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'anniversaries', filter }, meta)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter }, ev)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter }, ev)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'events' }, ev)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, meta)
      .subscribe()

    const onVisible = () => {
      if (document.visibilityState === 'visible') { txEvent(); metaEvent(); evEvent() }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      timers.forEach(clearTimeout)
      document.removeEventListener('visibilitychange', onVisible)
      void sb().removeChannel(channel)
    }
  }, [householdId])
}
