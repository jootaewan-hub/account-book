import { useState } from 'react'
import { ANNIV_KIND_LABEL, ANNIV_KINDS, annivDateLabel, dLabel, nextOccurrence, upcomingAnniversaries } from '../lib/anniversaries'
import { deleteAnniversary, friendlyError, insertAnniversary, updateAnniversary } from '../lib/api'
import type { Anniversary, AnniversaryInput } from '../lib/types'
import { AnnivIcon } from './Icons'

const EMPTY: AnniversaryInput = { name: '', kind: 'birthday', lunar: false, month: 1, day: 1 }
const SOLAR_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const maxDay = (lunar: boolean, month: number) => (lunar ? 30 : SOLAR_DAYS[month - 1])

interface Props {
  householdId: string
  annivs: Anniversary[]
  today: string
  onChanged: () => Promise<void>
  toast: (msg: string) => void
}

/** 설정 > 기념일: 가까운 순서로 보여 주고, 눌러서 고치거나 새로 넣는다 */
export function AnniversaryCard({ householdId, annivs, today, onChanged, toast }: Props) {
  const [edit, setEdit] = useState<{ id: string | null; v: AnniversaryInput } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const up = upcomingAnniversaries(annivs, today)
  const unknown = annivs.filter((a) => !up.some((u) => u.a.id === a.id)) // 음력 표 밖이라 날짜를 모름
  const thisYear = today.slice(0, 4)
  const solarLabel = (d: string) => `${d.slice(0, 4) !== thisYear ? `${d.slice(0, 4)}년 ` : ''}${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`

  function open(a: Anniversary | null) {
    setConfirmDelete(false)
    setEdit(a ? { id: a.id, v: { name: a.name, kind: a.kind, lunar: a.lunar, month: a.month, day: a.day } } : { id: null, v: EMPTY })
  }

  const set = (p: Partial<AnniversaryInput>) => setEdit((e) => {
    if (!e) return e
    const v = { ...e.v, ...p }
    return { ...e, v: { ...v, day: Math.min(v.day, maxDay(v.lunar, v.month)) } }
  })

  async function save() {
    if (!edit || !edit.v.name.trim()) return
    setBusy(true)
    try {
      const v = { ...edit.v, name: edit.v.name.trim() }
      if (edit.id) await updateAnniversary(edit.id, v)
      else await insertAnniversary(householdId, v)
      await onChanged()
      toast(edit.id ? '기념일을 고쳤어요' : '기념일을 넣었어요')
      setEdit(null)
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!edit?.id) return
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try {
      await deleteAnniversary(edit.id)
      await onChanged()
      toast('기념일을 지웠어요')
      setEdit(null)
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  function form() {
    if (!edit) return null
    const next = edit.v.lunar ? nextOccurrence(edit.v, today) : null
    return (
      <form className="anniv-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <input className="input" aria-label="기념일 이름" placeholder="예: 결혼기념일" maxLength={30}
          value={edit.v.name} onChange={(e) => set({ name: e.target.value })} />
        <div className="seg" role="group" aria-label="종류">
          {ANNIV_KINDS.map((k) => (
            <button type="button" key={k} aria-pressed={edit.v.kind === k} onClick={() => set({ kind: k })}>{ANNIV_KIND_LABEL[k]}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="양력 또는 음력">
          <button type="button" aria-pressed={!edit.v.lunar} onClick={() => set({ lunar: false })}>양력</button>
          <button type="button" aria-pressed={edit.v.lunar} onClick={() => set({ lunar: true })}>음력</button>
        </div>
        <div className="form-grid" style={{ marginTop: 0 }}>
          <select className="input" aria-label="월" value={edit.v.month} onChange={(e) => set({ month: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}
          </select>
          <select className="input" aria-label="일" value={edit.v.day} onChange={(e) => set({ day: Number(e.target.value) })}>
            {Array.from({ length: maxDay(edit.v.lunar, edit.v.month) }, (_, i) => <option key={i} value={i + 1}>{i + 1}일</option>)}
          </select>
        </div>
        {edit.v.lunar && <p className="tx-meta" style={{ margin: 0 }}>{next ? `다가오는 날은 양력 ${solarLabel(next)}이에요.` : '이 날짜는 아직 양력으로 바꿀 수 없어요.'}</p>}
        <div className="form-grid" style={{ marginTop: 0 }}>
          <button type="button" className="ghost" onClick={() => setEdit(null)}>취소</button>
          <button className="primary" disabled={busy || !edit.v.name.trim()}>{edit.id ? '고치기' : '넣기'}</button>
        </div>
        {edit.id && <button type="button" className="danger" disabled={busy} onClick={remove}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제'}</button>}
      </form>
    )
  }

  const row = (a: Anniversary, date: string | null, days: number | null) => edit?.id === a.id ? <div key={a.id}>{form()}</div> : (
    <button key={a.id} className="rc-row anniv-item" onClick={() => open(a)}>
      <span className={`anniv-ic k-${a.kind}`}><AnnivIcon kind={a.kind} /></span>
      <span className="rc-main"><b>{a.name}</b><span>{annivDateLabel(a)}{a.lunar && date ? `, 양력 ${solarLabel(date)}` : ''}</span></span>
      <span className="rc-side num">{days === null ? '' : dLabel(days)}</span>
    </button>
  )

  return (
    <div className="card">
      <h3 className="section-title">기념일</h3>
      <p className="tx-meta" style={{ marginTop: -6, marginBottom: 6 }}>달력에 표시돼요. 음력은 해마다 양력 날짜로 바꿔 보여 줘요.</p>
      {annivs.length === 0 && !edit && <p className="empty">아직 넣은 기념일이 없어요.</p>}
      {up.map((u) => row(u.a, u.date, u.days))}
      {unknown.map((a) => row(a, null, null))}
      {edit && edit.id === null ? form() : !edit && (
        <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => open(null)}>기념일 추가</button>
      )}
    </div>
  )
}
