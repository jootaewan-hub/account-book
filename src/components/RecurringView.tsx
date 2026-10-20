import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchRange, fetchRecurring, friendlyError, generateRecurring, recordRecurring } from '../lib/api'
import { addMonths } from '../lib/dates'
import { won } from '../lib/format'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import { installmentsLeft, KIND_LABEL, monthlyAmount, nextDue, pastAmounts, pendingInputs, subscriptionCandidates, termLeft } from '../lib/recurring'
import type { Category, Recurring, RecurringKind, Transaction } from '../lib/types'
import { draftFrom, RecurringSheet, type RecurringDraft } from './RecurringSheet'
import { RecurringIcon } from './RecurringIcon'
import { ServiceLogo } from './ServiceLogo'

interface Props {
  householdId: string
  today: string
  lookup: Lookup
  categories: Category[]
  /** 내역이 새로 들어갔을 때 달력·내역을 다시 불러온다 */
  onTxChanged: () => Promise<void>
  toast: (msg: string) => void
}

const KINDS: RecurringKind[] = ['fixed', 'subscription', 'utility']
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`

export function RecurringView({ householdId, today, lookup, categories, onTxChanged, toast }: Props) {
  const [list, setList] = useState<Recurring[] | null>(null)
  const [history, setHistory] = useState<Transaction[]>([])
  const [err, setErr] = useState('')
  const [sheet, setSheet] = useState<RecurringDraft | null>(null)

  const load = useCallback(async () => {
    try {
      const [l, h] = await Promise.all([
        fetchRecurring(householdId),
        fetchRange(householdId, `${addMonths(today.slice(0, 7), -5)}-01`, today),
      ])
      setList(l); setHistory(h); setErr('')
    } catch (e) {
      setErr(friendlyError(e))
    }
  }, [householdId, today])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  async function saved(msg: string) {
    setSheet(null)
    const n = await generateRecurring(householdId, today).catch(() => 0)
    await load()
    if (n) await onTxChanged()
    toast(n ? `${msg}. 내역 ${n}건을 넣었어요` : msg)
  }

  const pending = useMemo(() => (list ? pendingInputs(list, history, today) : []), [list, history, today])
  const candidates = useMemo(() => (list ? subscriptionCandidates(history, list) : []), [history, list])

  if (!list) return <section className="view"><p className="lead">{err || '불러오는 중…'}</p></section>

  // 끝나는 달이 있는 항목(할부, 기간을 정한 고정지출·구독)은 남은 회차가 있는 것만 매달 나가는 돈에 넣는다
  const active = list.filter((r) => r.active && r.type === 'expense' && (r.end_month === null || installmentsLeft(r, today) > 0))
  const sumOf = (k: RecurringKind) => active.filter((r) => r.kind === k).reduce((s, r) => s + monthlyAmount(r), 0)
  const utilityLast = active.filter((r) => r.kind === 'utility' && r.amount === null)
    .reduce((s, r) => s + (pastAmounts(r, history)[0]?.amount ?? 0), 0)
  const installment = sumOf('installment')
  const hasInstallments = list.some((r) => r.kind === 'installment')
  const kinds: RecurringKind[] = hasInstallments ? [...KINDS, 'installment'] : KINDS

  return (
    <section className="view">
      {err && <p className="banner" role="alert">{err}</p>}
      <div className="card">
        <div className={`summary${installment > 0 ? ' four' : ''}`}>
          <div><div className="k">고정지출</div><div className="v num">{won(sumOf('fixed'))}</div></div>
          <div><div className="k">구독</div><div className="v num">{won(sumOf('subscription'))}</div></div>
          <div><div className="k">관리비·공과금</div><div className="v num">{won(sumOf('utility') + utilityLast)}</div></div>
          {installment > 0 && <div><div className="k">할부</div><div className="v num">{won(installment)}</div></div>}
        </div>
        <div className="compare">
          매달 나가는 돈 약 <b className="num">{won(sumOf('fixed') + sumOf('subscription') + sumOf('utility') + utilityLast + installment)}원</b>
          {utilityLast > 0 && <> (금액이 달라지는 항목은 지난번 금액 기준)</>}
        </div>
      </div>

      {pending.map(({ r, due }) => (
        <PendingCard key={r.id} r={r} due={due} past={pastAmounts(r, history)} onSave={async (amount) => {
          try {
            await recordRecurring(householdId, r, `${today.slice(0, 7)}-01`, due, amount)
            await load(); await onTxChanged(); toast(`${r.title} ${won(amount)}원을 넣었어요`)
          } catch (e) { toast(friendlyError(e)) }
        }} />
      ))}

      {kinds.map((k) => {
        const items = list.filter((r) => r.kind === k)
        return (
          <div className="card" key={k}>
            <h2 className="section-title">{KIND_LABEL[k]}</h2>
            {items.length === 0 && <p className="empty">아직 없어요</p>}
            {items.map((r) => {
              const next = nextDue(r, today)
              const last = r.amount === null ? pastAmounts(r, history)[0] : undefined
              const left = k === 'installment' ? installmentsLeft(r, today) : termLeft(r, today)
              return (
                <button key={r.id} className={`rc-row${r.active ? '' : ' off'}`} onClick={() => setSheet(draftFrom(r))}>
                  {k === 'subscription' ? <ServiceLogo name={r.title} size={34} /> : <RecurringIcon kind={r.kind} title={r.title} type={r.type} size={34} />}
                  <span className="rc-main">
                    <b>{r.title}</b>
                    <span className="tx-meta">
                      {r.every_months === 12 ? `매년 ${Number(r.start_month.slice(5, 7))}월 ` : '매달 '}
                      {r.day_of_month === 31 ? '말일' : `${r.day_of_month}일`}
                      {`, ${SCOPE_LABEL[r.scope]}`}
                      {k === 'installment' && left !== null && (left > 0 ? `, ${r.installment_months}개월 중 남은 ${left}회` : ', 다 냈어요')}
                      {k !== 'installment' && left !== null && r.end_month && (left > 0
                        ? `, ${r.end_month.slice(0, 4)}년 ${Number(r.end_month.slice(5, 7))}월까지 ${left}회 남음`
                        : ', 끝났어요')}
                      {!r.active && ', 꺼 둠'}
                    </span>
                  </span>
                  <span className="rc-side">
                    <span className={`num ${r.type === 'income' ? 'inc' : ''}`}>
                      {r.amount === null ? (last ? `지난번 ${won(last.amount)}` : '매달 입력') : `${won(r.amount)}원`}
                    </span>
                    {r.active && next && <span className="tx-meta">다음 {md(next)}</span>}
                  </span>
                </button>
              )
            })}
            {k === 'installment'
              ? <p className="tx-meta">할부는 문자·사진으로 넣을 때 결제를 할부로 고르면 생겨요. 취득세·가전 할부처럼 직접 넣는 것은 고정지출에 기간을 정해 추가하세요.</p>
              : <button className="ghost full-btn" onClick={() => setSheet({ kind: k })}>+ {KIND_LABEL[k]} 추가</button>}
          </div>
        )
      })}

      {candidates.length > 0 && (
        <div className="card">
          <h2 className="section-title">구독 같아요</h2>
          <p className="tx-meta" style={{ marginTop: -6, marginBottom: 6 }}>최근 6개월에 같은 금액이 여러 달 나왔어요.</p>
          {candidates.slice(0, 5).map((c) => (
            <div className="set-row" key={`${c.title}|${c.amount}`}>
              <ServiceLogo name={c.title} size={28} />
              <span style={{ minWidth: 0, flex: 1 }}>
                {c.title} <span className="num">{won(c.amount)}원</span>
                <span className="r"> {c.months.map((m) => `${Number(m.slice(5))}월`).join(', ')}</span>
              </span>
              <button className="link-btn" onClick={() => setSheet({
                kind: 'subscription', title: c.title.trim(), amount: c.amount, day_of_month: c.day,
                category_id: c.category_id ?? undefined, payment_method_id: c.payment_method_id,
                start_month: `${addMonths(today.slice(0, 7), 1)}-01`,
              })}>등록</button>
            </div>
          ))}
          <p className="note">휴대폰의 구독 목록은 앱이 읽을 수 없어서(iPhone 제한), 가계부에 들어온 내역에서 찾습니다. 등록하면 다음 달부터 자동으로 들어가요.</p>
        </div>
      )}

      <RecurringSheet open={sheet !== null} draft={sheet} householdId={householdId} today={today} lookup={lookup}
        categories={categories} onSaved={saved} onClose={() => setSheet(null)} />
    </section>
  )
}

function PendingCard({ r, due, past, onSave }: {
  r: Recurring
  due: string
  past: { date: string; amount: number }[]
  onSave: (amount: number) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const n = parseInt(amount || '0', 10)
  return (
    <div className="card pending">
      <b>{r.title} 입력할 차례예요 ({md(due)})</b>
      {past.length > 0 && (
        <span className="tx-meta">
          지난 금액: {past.slice(0, 3).map((p) => `${Number(p.date.slice(5, 7))}월 ${won(p.amount)}원`).join(', ')}
        </span>
      )}
      <div className="form-grid">
        <input className="input num" inputMode="numeric" aria-label={`${r.title} 금액`} placeholder="이번 달 금액"
          value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))} />
        <button className="primary" disabled={!n || busy} onClick={async () => { setBusy(true); await onSave(n); setBusy(false) }}>
          {busy ? '저장 중…' : '넣기'}
        </button>
      </div>
    </div>
  )
}
