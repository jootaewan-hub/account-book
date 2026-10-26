import { useState } from 'react'
import { annivCategories, annivDateLabel, annivInput, dLabel, newAnnivInput, upcomingAnniversaries } from '../lib/anniversaries'
import { deleteAnniversary, friendlyError, insertAnniversary, updateAnniversary } from '../lib/api'
import type { Anniversary } from '../lib/types'
import { AnniversaryForm } from './AnniversaryForm'
import { AnnivIcon } from './Icons'

interface Props {
  householdId: string
  annivs: Anniversary[]
  today: string
  onChanged: () => Promise<void>
  toast: (msg: string) => void
}

/** 설정 > 기념일: 가까운 순서로 보여 주고, 눌러서 고치거나 새로 넣는다 */
export function AnniversaryCard({ householdId, annivs, today, onChanged, toast }: Props) {
  // null: 닫힘, 'new': 새로 넣기, 그 밖: 고치는 기념일 id
  const [edit, setEdit] = useState<string | null>(null)
  const up = upcomingAnniversaries(annivs, today)
  const unknown = annivs.filter((a) => !up.some((u) => u.a.id === a.id)) // 음력 표 밖이라 날짜를 모름
  const thisYear = today.slice(0, 4)
  const solarLabel = (d: string) => `${d.slice(0, 4) !== thisYear ? `${d.slice(0, 4)}년 ` : ''}${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); await onChanged(); toast(ok); setEdit(null) } catch (e) { toast(friendlyError(e)) }
  }

  const categories = annivCategories(annivs)
  const form = (a: Anniversary | null) => (
    <AnniversaryForm key={a?.id ?? 'new'} today={today} editing={a !== null} categories={categories}
      initial={a ? annivInput(a) : newAnnivInput()}
      onCancel={() => setEdit(null)}
      onSave={(v) => run(() => (a ? updateAnniversary(a.id, v) : insertAnniversary(householdId, v)), a ? '기념일을 고쳤어요' : '기념일을 넣었어요')}
      onDelete={a ? () => run(() => deleteAnniversary(a.id), '기념일을 지웠어요') : undefined} />
  )

  const row = (a: Anniversary, date: string | null, days: number | null) => edit === a.id ? <div key={a.id}>{form(a)}</div> : (
    <button key={a.id} className="rc-row anniv-item" onClick={() => setEdit(a.id)}>
      <span className={`anniv-ic k-${a.kind}`}><AnnivIcon kind={a.kind} /></span>
      <span className="rc-main"><b>{a.name}</b><span>{a.category ? `${a.category} · ` : ''}{annivDateLabel(a)}{a.lunar && date ? `, 양력 ${solarLabel(date)}` : ''}</span></span>
      <span className="rc-side num">{days === null ? '' : dLabel(days)}</span>
    </button>
  )

  return (
    <div className="card">
      <h2 className="section-title">기념일</h2>
      <p className="tx-meta" style={{ marginTop: -6, marginBottom: 6 }}>달력에 표시돼요. 해마다·몇 년마다·매달·몇 달마다 중에서 고르고, 카테고리는 직접 적어요. 음력은 양력 날짜로 바꿔 보여 줘요.</p>
      {annivs.length === 0 && edit !== 'new' && <p className="empty">아직 넣은 기념일이 없어요.</p>}
      {up.map((u) => row(u.a, u.date, u.days))}
      {unknown.map((a) => row(a, null, null))}
      {edit === 'new' ? form(null) : edit === null && (
        <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setEdit('new')}>기념일 추가</button>
      )}
    </div>
  )
}
