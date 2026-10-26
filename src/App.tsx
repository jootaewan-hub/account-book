import type { Session } from '@supabase/supabase-js'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarView } from './components/CalendarView'
import { EntrySheet } from './components/EntrySheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CalendarIcon, CartIcon, ChartIcon, ChevronLeft, ChevronRight, GearIcon, ListIcon, Plus, RepeatIcon } from './components/Icons'
import { ListView, type ListFocus } from './components/ListView'
import { Soft, Toast } from './components/Motion'
import { PlanSheet, type PlanTarget } from './components/PlanSheet'
import { PlatformDatalist } from './components/PlatformInput'
import { Login, NewPassword } from './components/Login'
import { Onboarding } from './components/Onboarding'
import type { SmartMode } from './components/SmartSheet'
import { useLedgerMeta, useLiveUpdates, useMonthEvents, useMonthTransactions, useRecurringList } from './hooks/useLedger'
import { deleteTransaction, deleteTransactions, friendlyError, generateRecurring, insertInstallmentPurchase, insertTransaction, updateSpouseRole, updateTransaction } from './lib/api'
import { wasRefreshed } from './lib/appUpdate'
import { takeNewRelease } from './lib/changelog'
import { addMonths, parseYM, todayLocal } from './lib/dates'
import { lsGet, lsSet } from './lib/localPrefs'
import { makeLookup, SCOPE_LABEL } from './lib/lookup'
import { onUpdateReady, updateReady } from './lib/pwa'
import { isConfigured, sb } from './lib/supabase'
import type { Household, Spouse, Transaction, TxInput } from './lib/types'

// 처음 여는 달력·내역 밖의 화면은 따로 묶어(코드 분할) 눌렀을 때 불러온다. 첫 화면이 빨리 뜨고, 새 버전도 바뀐 묶음만 받는다.
// 장보기(화면·저장소·CSS)와 스마트 입력(모델 결과 다듬기·사진 자르기·장보기 비교)이 가장 크다.
const GroceryTab = lazy(() => import('./grocery/GroceryTab').then((m) => ({ default: m.GroceryTab })))
const StatsView = lazy(() => import('./components/StatsView').then((m) => ({ default: m.StatsView })))
const RecurringView = lazy(() => import('./components/RecurringView').then((m) => ({ default: m.RecurringView })))
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })))
const ExportCard = lazy(() => import('./components/ExportCard').then((m) => ({ default: m.ExportCard })))
const SmartSheet = lazy(() => import('./components/SmartSheet').then((m) => ({ default: m.SmartSheet })))

/** 첫 화면이 뜬 뒤 쉬는 틈에 나머지 묶음을 미리 받아 둔다(탭을 누를 때 기다리지 않게) */
function prefetchChunks() {
  void Promise.allSettled([
    import('./grocery/GroceryTab'), import('./components/StatsView'), import('./components/SmartSheet'),
    import('./components/RecurringView'), import('./components/SettingsView'), import('./components/ExportCard'),
  ])
}

export default function App() {
  if (!isConfigured) return <SetupNeeded />
  return <><AuthGate /><UpdateBar /><PlatformDatalist /></>
}

function UpdateBar() {
  const [show, setShow] = useState(updateReady)
  useEffect(() => onUpdateReady(() => setShow(true)), [])
  if (!show) return null
  return <button className="update-bar" onClick={() => window.location.reload()}>새 버전이 있어요. 눌러서 새로 고침</button>
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
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    // 저장된 세션을 못 읽으면(저장공간 막힘 등) 로그인 화면으로 간다. "불러오는 중"에 멈추지 않게
    sb().auth.getSession().then(({ data }) => setSession(data.session), () => setSession(null))
    const { data } = sb().auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="app wrap center"><p className="lead">불러오는 중…</p></div>
  if (recovery && session) return <NewPassword onDone={() => setRecovery(false)} />
  if (!session) return <Login />
  return <Home userId={session.user.id} email={session.user.email ?? ''} />
}

function Home({ userId, email }: { userId: string; email: string }) {
  const meta = useLedgerMeta()
  if (meta.household === undefined) {
    // 처음 불러오기가 실패하면 가입 화면 대신 오류와 다시 시도를 보여 준다 (가구가 있는 사람을 '새 가계부 만들기'로 보내지 않는다)
    return (
      <div className="app wrap center">
        <p className="lead">{meta.error ? '가계부를 불러오지 못했어요' : '불러오는 중…'}</p>
        {meta.error && <><p className="err">{meta.error}</p><button className="ghost" onClick={() => void meta.reload()}>다시 시도</button></>}
      </div>
    )
  }
  if (meta.household === null) return <Onboarding onDone={meta.reload} />
  return <Ledger household={meta.household} meta={meta} userId={userId} email={email} />
}

type Tab = 'cal' | 'list' | 'grocery' | 'stats' | 'fixed' | 'settings'

/** 처음 열 탭: ?tab=grocery(예전 장보기 주소의 안내 페이지가 여기로 보낸다). 다른 값은 무시한다. 설정에서 앱 파일을 다시 받았으면 설정 */
function initialTab(): Tab {
  if (wasRefreshed()) return 'settings'
  return new URLSearchParams(window.location.search).get('tab') === 'grocery' ? 'grocery' : 'cal'
}

const TITLE: Record<Tab, string> = { cal: '우리집', list: '내역', grocery: '장보기', stats: '통계', fixed: '고정 지출', settings: '설정' }

/** 따로 받는 화면이 오는 동안의 자리. 한 화면이 그리다 멈추면 그 자리에만 오류를 보이고, 다른 탭으로 옮기면(key) 풀린다 */
function Screen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary key={name} name={name}>
      <Suspense fallback={<p className="lead">불러오는 중…</p>}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function Ledger({ household, meta, userId, email }: {
  household: Household
  meta: ReturnType<typeof useLedgerMeta>
  userId: string
  email: string
}) {
  const [today, setToday] = useState(todayLocal())
  const [ym, setYm] = useState(today.slice(0, 7))
  const [sel, setSel] = useState(today)
  const [tab, setTab] = useState<Tab>(initialTab)
  // 설정은 아래 탭이 아니라 위쪽 톱니 버튼으로 연다. 돌아가기는 설정을 연 탭으로
  const [beforeSettings, setBeforeSettings] = useState<Exclude<Tab, 'settings'>>('cal')
  const openSettings = () => { if (tab !== 'settings') setBeforeSettings(tab); setTab('settings') }
  const [sheet, setSheet] = useState<{ open: boolean; editing: Transaction | null }>({ open: false, editing: null })
  const [smart, setSmart] = useState<{ open: boolean; mode: SmartMode }>({ open: false, mode: 'text' })
  // 스마트 입력 시트는 처음 열 때 불러오고, 그 뒤로는 닫히는 움직임을 위해 화면에 남겨 둔다
  const [smartMounted, setSmartMounted] = useState(false)
  const openSmart = (mode: SmartMode) => { setSmartMounted(true); setSmart({ open: true, mode }) }
  const closeSmart = () => setSmart((s) => ({ ...s, open: false }))
  // 관리비 고지서를 저장하면 통계 탭의 관리비 분석을 다시 불러온다
  const [billsVersion, setBillsVersion] = useState(0)
  const [toastMsg, setToastMsg] = useState('')
  // 통계에서 분류·플랫폼을 눌러 내역 탭으로 넘어올 때의 조건
  const [listFocus, setListFocus] = useState<ListFocus | null>(null)
  // 내역 탭에서 지울 내역을 고르는 중이면 기록하기 둥근 버튼을 숨긴다(고른 내역 줄이 그 자리에 뜬다)
  const [listPicking, setListPicking] = useState(false)

  const { txs, version: txVersion, loading: txLoading, error, reload } = useMonthTransactions(household.id, ym)
  const { events, reload: reloadEvents } = useMonthEvents(household.id, ym)
  // 달력의 고정지출 예정분(D-030). 달력 탭에 올 때마다 다시 읽어 고정 탭에서 고친 것이 바로 보인다
  const recurring = useRecurringList(household.id, tab === 'cal')
  const [plan, setPlan] = useState<PlanTarget | null>(null)
  useLiveUpdates(household.id, reload, meta.reload, reloadEvents)

  // 자정이 지나 앱을 다시 열면 '오늘'을 갱신
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setToday(todayLocal()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // 첫 화면이 자리 잡은 뒤 나머지 화면 묶음을 미리 받는다
  useEffect(() => {
    const t = window.setTimeout(prefetchChunks, 1500)
    return () => window.clearTimeout(t)
  }, [])

  // 같은 문장이 연달아 와도 앞 토스트의 타이머가 뒤 토스트를 지우지 않도록 번호를 매긴다
  const toastSeq = useRef(0)
  const toast = useCallback((msg: string) => {
    const id = ++toastSeq.current
    setToastMsg(msg)
    window.setTimeout(() => { if (toastSeq.current === id) setToastMsg('') }, 2400)
  }, [])

  // 날짜가 지난 고정지출·구독을 자동으로 넣는다 (앱을 열 때, 날짜가 바뀌었을 때)
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload }, [reload])
  useEffect(() => {
    let alive = true
    generateRecurring(household.id, today)
      .then(async (n) => { if (alive && n > 0) { await reloadRef.current(); toast(`고정지출·구독 ${n}건을 넣었어요`) } })
      .catch(() => { /* 실패해도 다음에 다시 시도한다 */ })
    return () => { alive = false }
  }, [household.id, today, toast])

  const lookup = useMemo(() => makeLookup(userId, meta.members, meta.methods, meta.categories), [userId, meta.members, meta.methods, meta.categories])
  const cur = useMemo(() => txs.filter((t) => t.occurred_on.startsWith(ym)), [txs, ym])
  const prev = useMemo(() => txs.filter((t) => !t.occurred_on.startsWith(ym)), [txs, ym])
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of txs) if (t.category_id) m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1)
    return m
  }, [txs])

  const activeCats = useMemo(() => meta.categories.filter((c) => !c.archived), [meta.categories])

  function goMonth(n: number) {
    const next = addMonths(ym, n)
    setYm(next)
    setSel(next === today.slice(0, 7) ? today : `${next}-01`)
  }

  async function save(input: TxInput, id?: string, installment?: { months: number; split: boolean } | null) {
    let split = false
    if (id) await updateTransaction(id, input)
    else if (installment) split = await insertInstallmentPurchase(household.id, input, installment.months, installment.split)
    else await insertTransaction(household.id, input)
    // 지난 날짜에 산 할부면 이미 지난 회차를 바로 넣는다
    if (split) await generateRecurring(household.id, today).catch(() => 0)
    setSheet({ open: false, editing: null })
    setYm(input.occurred_on.slice(0, 7))
    setSel(input.occurred_on)
    await reload()
    toast(id ? '수정했어요' : split ? '저장했어요. 할부 남은 회차는 고정 탭의 할부에 넣었어요' : '저장했어요')
  }

  // 새 버전을 이 기기에서 처음 열면 한 번 알린다(바뀐 점은 설정 > 앱의 업데이트 내역)
  useEffect(() => {
    const r = takeNewRelease({ get: lsGet, set: lsSet })
    if (r) toast(`새 버전 v${r.version}: ${r.title}`)
  }, [toast])

  async function smartSaved(count: number, lastDate: string, msg?: string) {
    closeSmart()
    setYm(lastDate.slice(0, 7))
    setSel(lastDate)
    await reload()
    setBillsVersion((v) => v + 1)
    toast(msg ?? `${count}건 저장했어요`)
  }

  async function remove(id: string) {
    await deleteTransaction(id)
    setSheet({ open: false, editing: null })
    await reload()
    toast('삭제했어요')
  }

  // 여러 건 지우기(D-027): 내역 탭 고르기, 같은 영수증 묶음. 중간에 멈춰도 목록은 새로 읽는다
  async function removeMany(ids: string[]) {
    let n: number
    try { n = await deleteTransactions(ids) } catch (e) { await reload(); throw e }
    setSheet({ open: false, editing: null })
    await reload()
    toast(n === ids.length ? `${n}건 삭제했어요` : `${ids.length}건 중 ${n}건을 지웠어요`)
  }

  const { y, m } = parseYM(ym)
  const showMonth = tab === 'cal' || tab === 'list' || tab === 'stats'

  return (
    // 넓은 화면에서는 아래 탭이 왼쪽 세로 메뉴가 된다 (styles.css 넓은 화면)
    <div className="app ledger" data-tab={tab}>
      <header className="topbar">
        <div className="wrap">
          <div className="top-left">
            {tab === 'settings' && (
              <button className="icon-btn narrow-only back-btn" onClick={() => setTab(beforeSettings)} aria-label="돌아가기"><ChevronLeft /></button>
            )}
            <h1 className={tab === 'cal' ? 'brand-mark' : undefined}>{TITLE[tab]}</h1>
          </div>
          <div className="top-right">
            {showMonth && (
              <>
                {ym !== today.slice(0, 7) && (
                  <button className="today-btn" onClick={() => { setYm(today.slice(0, 7)); setSel(today) }}>오늘</button>
                )}
                <div className="month-nav">
                  <button className="icon-btn" onClick={() => goMonth(-1)} aria-label="이전 달"><ChevronLeft /></button>
                  <span className="ym num" aria-live="polite"><Soft value={y === Number(today.slice(0, 4)) ? `${m}월` : `${y}년 ${m}월`} /></span>
                  <button className="icon-btn" onClick={() => goMonth(1)} aria-label="다음 달"><ChevronRight /></button>
                </div>
              </>
            )}
            {/* 휴대폰에서만 보인다. 넓은 화면은 왼쪽 메뉴의 설정 줄을 쓴다 */}
            {tab !== 'settings' && (
              <button className="icon-btn narrow-only" onClick={openSettings} aria-label="설정"><GearIcon /></button>
            )}
          </div>
        </div>
      </header>

      <main className="wrap">
        {error && <p className="banner" role="alert">내역을 불러오지 못했어요: {error}</p>}
        {!lookup.myRole && tab !== 'settings' && (
          <div className="card role-card" style={{ marginBottom: 16 }}>
            <b>나는 남편인가요, 아내인가요?</b>
            <span className="lead" style={{ fontSize: 14 }}>내역에 누가 입력했는지 남편, 아내로 표시하는 데 써요. 설정에서 바꿀 수 있어요.</span>
            <div className="seg" role="group">
              {(['husband', 'wife'] as Spouse[]).map((r) => (
                <button key={r} onClick={async () => {
                  try { await updateSpouseRole(household.id, userId, r); await meta.reload(); toast(`${SCOPE_LABEL[r]}(으)로 정했어요`) } catch (e) { toast(friendlyError(e)) }
                }}>{SCOPE_LABEL[r]}</button>
              ))}
            </div>
          </div>
        )}
        {tab === 'cal' && (
          <Screen name="달력">
            <CalendarView ym={ym} today={today} sel={sel} cur={cur} prev={prev} loading={txLoading} lookup={lookup} annivs={meta.anniversaries} events={events}
              recurring={recurring} onSelect={setSel} onPlan={setPlan} onJump={(d) => { setYm(d.slice(0, 7)); setSel(d) }}
              onEdit={(t) => setSheet({ open: true, editing: t })} onOpenFixed={() => setTab('fixed')} />
          </Screen>
        )}
        {tab === 'list' && (
          <Screen name="내역">
            <ListView cur={cur} loading={txLoading} lookup={lookup} focus={listFocus} onClearFocus={() => setListFocus(null)} onEdit={(t) => setSheet({ open: true, editing: t })}
              onDeleteMany={removeMany} onPickingChange={setListPicking} />
          </Screen>
        )}
        {tab === 'grocery' && (
          <Screen name="장보기">
            <GroceryTab userId={userId} members={meta.members} categories={meta.categories} onRecorded={() => void reload()} />
          </Screen>
        )}
        {tab === 'stats' && (
          <Screen name="통계">
            <StatsView household={household} ym={ym} today={today} cur={cur} prev={prev} loading={txLoading} txVersion={txVersion} lookup={lookup}
              categories={meta.categories} billsVersion={billsVersion} onBill={() => openSmart('bill')}
              onFuel={() => openSmart('photo')}
              onCategory={(id, name) => { setListFocus({ kind: 'category', id, name }); setTab('list') }}
              onPlatform={(name, kind) => { setListFocus(kind === 'merchant' ? { kind: 'merchant', name } : { kind: 'platform', name }); setTab('list') }} />
          </Screen>
        )}
        {tab === 'fixed' && (
          <Screen name="고정 지출">
            <RecurringView householdId={household.id} today={today} lookup={lookup}
              categories={activeCats} onTxChanged={reload} toast={toast} />
          </Screen>
        )}
        {tab === 'settings' && (
          <Screen name="설정">
            <SettingsView household={household} categories={meta.categories} annivs={meta.anniversaries} today={today}
              lookup={lookup} email={email} onChanged={meta.reload} toast={toast} />
            <div style={{ height: 16 }} />
            <ExportCard householdId={household.id} today={today} lookup={lookup} toast={toast} />
          </Screen>
        )}
      </main>

      {(tab === 'cal' || (tab === 'list' && !listPicking)) && (
        <button className="fab" onClick={() => setSheet({ open: true, editing: null })}><Plus />기록하기</button>
      )}

      <nav className="tabbar" aria-label="화면 전환">
        <div className="wrap">
          {/* 넓은 화면에서만 보인다. 휴대폰은 오른쪽 아래 기록하기 버튼을 쓴다 */}
          <button className="primary side-record" onClick={() => setSheet({ open: true, editing: null })}><Plus />기록하기</button>
          <button className="tab" aria-current={tab === 'cal' ? 'page' : undefined} onClick={() => setTab('cal')}><CalendarIcon />달력</button>
          <button className="tab" aria-current={tab === 'list' ? 'page' : undefined} onClick={() => { setListFocus(null); setTab('list') }}><ListIcon />내역</button>
          <button className="tab" aria-current={tab === 'grocery' ? 'page' : undefined} onClick={() => setTab('grocery')}><CartIcon />장보기</button>
          <button className="tab" aria-current={tab === 'stats' ? 'page' : undefined} onClick={() => setTab('stats')}><ChartIcon />통계</button>
          <button className="tab" aria-current={tab === 'fixed' ? 'page' : undefined} onClick={() => setTab('fixed')}><RepeatIcon />고정</button>
          {/* 넓은 화면에서만 보인다. 휴대폰은 위쪽 톱니 버튼을 쓴다 */}
          <button className="tab side-settings" aria-current={tab === 'settings' ? 'page' : undefined} onClick={openSettings}><GearIcon />설정</button>
        </div>
      </nav>

      <ErrorBoundary name="기록하기">
        <EntrySheet open={sheet.open} editing={sheet.editing} defaultDate={sel.startsWith(ym) ? sel : today}
          lookup={lookup} categories={activeCats} usage={usage}
          onSave={save} onDelete={remove} onDeleteMany={removeMany} onClose={() => setSheet({ open: false, editing: null })}
          onSmart={(mode) => { setSheet({ open: false, editing: null }); openSmart(mode) }} />
      </ErrorBoundary>

      {smartMounted && (
        <ErrorBoundary name="스마트 입력">
          <Suspense fallback={null}>
            <SmartSheet open={smart.open} mode={smart.mode} today={today} householdId={household.id}
              lookup={lookup} categories={activeCats} existing={txs}
              onSaved={smartSaved} onClose={closeSmart}
              onManual={() => { closeSmart(); setSheet({ open: true, editing: null }) }} />
          </Suspense>
        </ErrorBoundary>
      )}

      <PlanSheet target={plan} householdId={household.id} today={today} onEventsChanged={reloadEvents}
        onAnnivsChanged={meta.reload} onClose={() => setPlan(null)} toast={toast} />

      <Toast msg={toastMsg} />
    </div>
  )
}
