import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarView } from './components/CalendarView'
import { EntrySheet } from './components/EntrySheet'
import { CalendarIcon, ChevronLeft, ChevronRight, GearIcon, ListIcon, Plus } from './components/Icons'
import { ListView } from './components/ListView'
import { Login } from './components/Login'
import { Onboarding } from './components/Onboarding'
import { SettingsView } from './components/SettingsView'
import { useLedgerMeta, useLiveUpdates, useMonthTransactions } from './hooks/useLedger'
import { deleteTransaction, insertTransaction, updateTransaction } from './lib/api'
import { addMonths, parseYM, todayLocal } from './lib/dates'
import { makeLookup } from './lib/lookup'
import { isConfigured, sb } from './lib/supabase'
import type { Household, Transaction, TxInput } from './lib/types'

export default function App() {
  if (!isConfigured) return <SetupNeeded />
  return <AuthGate />
}

function SetupNeeded() {
  return (
    <div className="app wrap center">
      <p className="brand">설정이 필요해요</p>
      <p className="lead">VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY 환경 변수를 넣고 다시 배포해 주세요. 자세한 내용은 README에 있습니다.</p>
    </div>
  )
}

function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    void sb().auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb().auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="app wrap center"><p className="lead">불러오는 중…</p></div>
  if (!session) return <Login />
  return <Home userId={session.user.id} email={session.user.email ?? ''} />
}

function Home({ userId, email }: { userId: string; email: string }) {
  const meta = useLedgerMeta()
  if (meta.household === undefined) {
    return <div className="app wrap center"><p className="lead">불러오는 중…</p>{meta.error && <p className="err">{meta.error}</p>}</div>
  }
  if (meta.household === null) return <Onboarding onDone={meta.reload} />
  return <Ledger household={meta.household} meta={meta} userId={userId} email={email} />
}

type Tab = 'cal' | 'list' | 'settings'

function Ledger({ household, meta, userId, email }: {
  household: Household
  meta: ReturnType<typeof useLedgerMeta>
  userId: string
  email: string
}) {
  const [today, setToday] = useState(todayLocal())
  const [ym, setYm] = useState(today.slice(0, 7))
  const [sel, setSel] = useState(today)
  const [tab, setTab] = useState<Tab>('cal')
  const [sheet, setSheet] = useState<{ open: boolean; editing: Transaction | null }>({ open: false, editing: null })
  const [toastMsg, setToastMsg] = useState('')

  const { txs, error, reload } = useMonthTransactions(household.id, ym)
  useLiveUpdates(household.id, reload, meta.reload)

  // 자정이 지나 앱을 다시 열면 '오늘'을 갱신
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setToday(todayLocal()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((m) => (m === msg ? '' : m)), 2000)
  }, [])

  const lookup = useMemo(() => makeLookup(userId, meta.members, meta.methods, meta.categories), [userId, meta.members, meta.methods, meta.categories])
  const cur = useMemo(() => txs.filter((t) => t.occurred_on.startsWith(ym)), [txs, ym])
  const prev = useMemo(() => txs.filter((t) => !t.occurred_on.startsWith(ym)), [txs, ym])
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txs) if (t.category_id) m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1)
    return m
  }, [txs])

  const activeMethods = meta.methods.filter((m) => !m.archived)
  const activeCats = meta.categories.filter((c) => !c.archived)

  function goMonth(n: number) {
    const next = addMonths(ym, n)
    setYm(next)
    setSel(next === today.slice(0, 7) ? today : `${next}-01`)
  }

  async function save(input: TxInput, id?: string) {
    if (id) await updateTransaction(id, input)
    else await insertTransaction(household.id, input)
    setSheet({ open: false, editing: null })
    setYm(input.occurred_on.slice(0, 7))
    setSel(input.occurred_on)
    await reload()
    toast(id ? '수정했어요' : '저장했어요')
  }

  async function remove(id: string) {
    await deleteTransaction(id)
    setSheet({ open: false, editing: null })
    await reload()
    toast('삭제했어요')
  }

  const { y, m } = parseYM(ym)
  const showMonth = tab !== 'settings'

  return (
    <div className="app">
      <header className="topbar">
        <div className="wrap">
          {showMonth ? (
            <div className="month-nav">
              <button className="icon-btn" onClick={() => goMonth(-1)} aria-label="이전 달"><ChevronLeft /></button>
              <h1 className="num">{y}년 {m}월</h1>
              <button className="icon-btn" onClick={() => goMonth(1)} aria-label="다음 달"><ChevronRight /></button>
            </div>
          ) : <h1>설정</h1>}
          {showMonth && ym !== today.slice(0, 7) && (
            <button className="today-btn" onClick={() => { setYm(today.slice(0, 7)); setSel(today) }}>오늘</button>
          )}
        </div>
      </header>

      <main className="wrap">
        {error && <p className="banner" role="alert">내역을 불러오지 못했어요: {error}</p>}
        {tab === 'cal' && (
          <CalendarView ym={ym} today={today} sel={sel} cur={cur} prev={prev} lookup={lookup}
            onSelect={setSel} onEdit={(t) => setSheet({ open: true, editing: t })} />
        )}
        {tab === 'list' && <ListView cur={cur} lookup={lookup} onEdit={(t) => setSheet({ open: true, editing: t })} />}
        {tab === 'settings' && (
          <SettingsView household={household} methods={meta.methods} categories={meta.categories}
            lookup={lookup} email={email} onChanged={meta.reload} toast={toast} />
        )}
      </main>

      {tab !== 'settings' && (
        <button className="fab" aria-label="내역 추가" onClick={() => setSheet({ open: true, editing: null })}><Plus /></button>
      )}

      <nav className="tabbar" aria-label="화면 전환">
        <div className="wrap">
          <button className="tab" aria-current={tab === 'cal' ? 'page' : undefined} onClick={() => setTab('cal')}><CalendarIcon />달력</button>
          <button className="tab" aria-current={tab === 'list' ? 'page' : undefined} onClick={() => setTab('list')}><ListIcon />내역</button>
          <button className="tab" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}><GearIcon />설정</button>
        </div>
      </nav>

      <EntrySheet open={sheet.open} editing={sheet.editing} defaultDate={sel.startsWith(ym) ? sel : today}
        lookup={lookup} methods={activeMethods} categories={activeCats} usage={usage}
        onSave={save} onDelete={remove} onClose={() => setSheet({ open: false, editing: null })} />

      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  )
}
