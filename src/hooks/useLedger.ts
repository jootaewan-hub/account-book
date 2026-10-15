import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHouseholdBundle, fetchTwoMonths } from '../lib/api'
import { sb } from '../lib/supabase'
import type { Category, Household, Member, PaymentMethod, Transaction } from '../lib/types'

export interface LedgerMeta {
  household: Household | null | undefined // undefined: 불러오는 중, null: 아직 가구 없음
  members: Member[]
  methods: PaymentMethod[]
  categories: Category[]
  error: string | null
  reload: () => Promise<void>
}

export function useLedgerMeta(): LedgerMeta {
  const [state, setState] = useState<Omit<LedgerMeta, 'reload'>>({
    household: undefined, members: [], methods: [], categories: [], error: null,
  })
  const reload = useCallback(async () => {
    try {
      const b = await fetchHouseholdBundle()
      setState({ ...b, error: null })
    } catch (e) {
      setState((s) => ({ ...s, household: s.household ?? null, error: (e as Error).message }))
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { ...state, reload }
}

export function useMonthTransactions(householdId: string | undefined, ym: string) {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const req = useRef(0)

  const reload = useCallback(async () => {
    if (!householdId) return
    const id = ++req.current
    try {
      const rows = await fetchTwoMonths(householdId, ym)
      if (id === req.current) { setTxs(rows); setError(null) }
    } catch (e) {
      if (id === req.current) setError((e as Error).message)
    } finally {
      if (id === req.current) setLoading(false)
    }
  }, [householdId, ym])

  useEffect(() => { setLoading(true); void reload() }, [reload])
  return { txs, loading, error, reload }
}

/**
 * 상대가 입력하면 바로 보이도록 Realtime 변경을 구독한다.
 * iOS 홈 화면 앱은 백그라운드에서 연결이 끊길 수 있어, 다시 화면에 나타나면 새로 불러온다.
 */
export function useLiveUpdates(householdId: string | undefined, onTx: () => void, onMeta: () => void) {
  const txRef = useRef(onTx)
  const metaRef = useRef(onMeta)
  txRef.current = onTx
  metaRef.current = onMeta

  useEffect(() => {
    if (!householdId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const debounced = (fn: () => void) => () => { clearTimeout(timer); timer = setTimeout(fn, 250) }
    const tx = debounced(() => txRef.current())
    const meta = () => metaRef.current()
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, meta)
      .subscribe()

    const onVisible = () => {
      if (document.visibilityState === 'visible') { txRef.current(); metaRef.current() }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      void sb().removeChannel(channel)
    }
  }, [householdId])
}
