import { useState } from 'react'
import { ANNIV_KIND_LABEL, ANNIV_KINDS, nextOccurrence } from '../lib/anniversaries'
import { solarToLunar } from '../lib/lunar'
import type { AnniversaryInput } from '../lib/types'

const SOLAR_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const maxDay = (lunar: boolean, month: number) => (lunar ? 30 : SOLAR_DAYS[month - 1])

/** 그 날짜를 기념일 월·일로 (음력이면 음력 월·일, 윤달은 같은 달로 본다) */
export function annivFromDate(date: string, lunar: boolean): Pick<AnniversaryInput, 'month' | 'day'> {
  const l = lunar ? solarToLunar(date) : null
  return l ? { month: l.month, day: l.day } : { month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) }
}

interface Props {
  initial: AnniversaryInput
  today: string
  /** 달력에서 고른 날짜로 새로 넣을 때: 양력·음력을 바꾸면 이 날짜를 기준으로 월·일을 다시 정한다 */
  fromDate?: string
  editing: boolean
  onSave: (v: AnniversaryInput) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}

/** 기념일 넣기·고치기 (설정의 기념일 목록과 달력의 일정·기념일 넣기에서 함께 쓴다) */
export function AnniversaryForm({ initial, today, fromDate, editing, onSave, onCancel, onDelete }: Props) {
  const [v, setV] = useState<AnniversaryInput>(initial)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (p: Partial<AnniversaryInput>) => setV((cur) => {
    const next = { ...cur, ...p }
    if (fromDate && p.lunar !== undefined && p.lunar !== cur.lunar) Object.assign(next, annivFromDate(fromDate, p.lunar))
    return { ...next, day: Math.min(next.day, maxDay(next.lunar, next.month)) }
  })
  const next = v.lunar ? nextOccurrence(v, today) : null
  const thisYear = today.slice(0, 4)
  const solarLabel = (d: string) => `${d.slice(0, 4) !== thisYear ? `${d.slice(0, 4)}년 ` : ''}${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`

  async function submit() {
    if (!v.name.trim()) return
    setBusy(true)
    try { await onSave({ ...v, name: v.name.trim() }) } finally { setBusy(false) }
  }

  async function remove() {
    if (!onDelete) return
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try { await onDelete() } finally { setBusy(false) }
  }

  return (
    <form className="anniv-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <input className="input" aria-label="기념일 이름" placeholder="예: 결혼기념일" maxLength={30}
        value={v.name} onChange={(e) => set({ name: e.target.value })} />
      <div className="seg" role="group" aria-label="종류">
        {ANNIV_KINDS.map((k) => (
          <button type="button" key={k} aria-pressed={v.kind === k} onClick={() => set({ kind: k })}>{ANNIV_KIND_LABEL[k]}</button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="양력 또는 음력">
        <button type="button" aria-pressed={!v.lunar} onClick={() => set({ lunar: false })}>양력</button>
        <button type="button" aria-pressed={v.lunar} onClick={() => set({ lunar: true })}>음력</button>
      </div>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <select className="input" aria-label="월" value={v.month} onChange={(e) => set({ month: Number(e.target.value) })}>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}
        </select>
        <select className="input" aria-label="일" value={v.day} onChange={(e) => set({ day: Number(e.target.value) })}>
          {Array.from({ length: maxDay(v.lunar, v.month) }, (_, i) => <option key={i} value={i + 1}>{i + 1}일</option>)}
        </select>
      </div>
      {v.lunar && <p className="tx-meta" style={{ margin: 0 }}>{next ? `다가오는 날은 양력 ${solarLabel(next)}이에요.` : '이 날짜는 아직 양력으로 바꿀 수 없어요.'}</p>}
      <div className="form-grid" style={{ marginTop: 0 }}>
        <button type="button" className="ghost" onClick={onCancel}>취소</button>
        <button className="primary" disabled={busy || !v.name.trim()}>{editing ? '고치기' : '넣기'}</button>
      </div>
      {editing && onDelete && (
        <button type="button" className="danger" disabled={busy} onClick={remove}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제'}</button>
      )}
    </form>
  )
}
