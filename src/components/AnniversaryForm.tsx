import { useState } from 'react'
import { finishAnnivInput, nextOccurrence } from '../lib/anniversaries'
import { solarToLunar } from '../lib/lunar'
import type { AnniversaryInput } from '../lib/types'

const SOLAR_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const maxDay = (lunar: boolean, month: number) => (lunar ? 30 : SOLAR_DAYS[month - 1])

/** 그 날짜를 기념일 월·일로 (음력이면 음력 월·일, 윤달은 같은 달로 본다) */
export function annivFromDate(date: string, lunar: boolean): Pick<AnniversaryInput, 'month' | 'day'> {
  const l = lunar ? solarToLunar(date) : null
  return l ? { month: l.month, day: l.day } : { month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) }
}

/** 반복 고르기(D-033): 해마다, 몇 년마다, 매달, 몇 달마다. '몇'은 숫자 칸으로 적는다 */
type RepeatMode = 'y1' | 'yN' | 'm1' | 'mN'
const REPEATS: [RepeatMode, string][] = [['y1', '해마다'], ['yN', '몇 년마다'], ['m1', '매달'], ['mN', '몇 달마다']]
const modeOf = (v: AnniversaryInput): RepeatMode => (v.repeat_unit === 'month' ? (v.repeat_every > 1 ? 'mN' : 'm1') : v.repeat_every > 1 ? 'yN' : 'y1')

interface Props {
  initial: AnniversaryInput
  today: string
  /** 고를 수 있는 카테고리(가구에서 쓴 것 + 기본 말, annivCategories) */
  categories: string[]
  /** 달력에서 고른 날짜로 새로 넣을 때: 양력·음력을 바꾸면 이 날짜를 기준으로 월·일을 다시 정한다 */
  fromDate?: string
  editing: boolean
  onSave: (v: AnniversaryInput) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}

/** 기념일 넣기·고치기 (설정의 기념일 목록과 달력의 일정·기념일 넣기에서 함께 쓴다) */
export function AnniversaryForm({ initial, today, categories, fromDate, editing, onSave, onCancel, onDelete }: Props) {
  const thisYear = Number(today.slice(0, 4))
  const [v, setV] = useState<AnniversaryInput>(initial)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (p: Partial<AnniversaryInput>) => setV((cur) => {
    const next = { ...cur, ...p }
    if (next.repeat_unit === 'month') next.lunar = false
    if (fromDate && next.lunar !== cur.lunar) Object.assign(next, annivFromDate(fromDate, next.lunar))
    return { ...next, day: Math.min(next.day, maxDay(next.lunar, next.month)) }
  })
  const mode = modeOf(v)
  const monthly = v.repeat_unit === 'month'
  const needsStart = monthly || v.repeat_every > 1
  const startYear = v.start_year ?? (fromDate ? Number(fromDate.slice(0, 4)) : thisYear)
  const done = finishAnnivInput({ ...v, start_year: needsStart ? startYear : v.start_year }, thisYear)
  const next = v.lunar || needsStart ? nextOccurrence(done, today) : null
  const solarLabel = (d: string) => `${Number(d.slice(0, 4)) !== thisYear ? `${d.slice(0, 4)}년 ` : ''}${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`
  const years = Array.from({ length: 71 }, (_, i) => thisYear + 10 - i)

  function pickRepeat(m: RepeatMode) {
    const unit = m[0] === 'm' ? 'month' : 'year'
    const every = m[1] === '1' ? 1 : Math.max(2, v.repeat_every > 1 && v.repeat_unit === unit ? v.repeat_every : unit === 'month' ? 3 : 2)
    set({ repeat_unit: unit, repeat_every: every, start_year: v.start_year ?? startYear })
  }

  async function submit() {
    if (!v.name.trim()) return
    setBusy(true)
    try { await onSave(done) } finally { setBusy(false) }
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
      <input className="input" aria-label="카테고리" placeholder="카테고리 (예: 생일, 병원) 직접 적거나 아래에서 골라요" maxLength={12}
        value={v.category ?? ''} onChange={(e) => set({ category: e.target.value })} />
      <div className="chips anniv-cats" role="group" aria-label="카테고리 고르기">
        {categories.map((c) => (
          <button type="button" key={c} className="chip" aria-pressed={v.category?.trim() === c}
            onClick={() => set({ category: v.category?.trim() === c ? null : c })}>{c}</button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="반복">
        {REPEATS.map(([m, label]) => (
          <button type="button" key={m} aria-pressed={mode === m} onClick={() => pickRepeat(m)}>{label}</button>
        ))}
      </div>
      {(mode === 'yN' || mode === 'mN') && (
        <label className="anniv-every">
          <input className="input num" type="number" inputMode="numeric" min={2} max={100} aria-label={mode === 'yN' ? '몇 년마다' : '몇 달마다'}
            value={v.repeat_every} onChange={(e) => set({ repeat_every: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })} />
          <span>{mode === 'yN' ? '년마다' : '개월마다'}</span>
        </label>
      )}
      {!monthly && (
        <div className="seg" role="group" aria-label="양력 또는 음력">
          <button type="button" aria-pressed={!v.lunar} onClick={() => set({ lunar: false })}>양력</button>
          <button type="button" aria-pressed={v.lunar} onClick={() => set({ lunar: true })}>음력</button>
        </div>
      )}
      <div className={`form-grid${needsStart ? ' three' : ''}`} style={{ marginTop: 0 }}>
        {needsStart && (
          <select className="input" aria-label="시작한 해" value={startYear} onChange={(e) => set({ start_year: Number(e.target.value) })}>
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
        )}
        <select className="input" aria-label={monthly ? '시작한 달' : '월'} value={v.month} onChange={(e) => set({ month: Number(e.target.value) })}>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}월</option>)}
        </select>
        <select className="input" aria-label="일" value={v.day} onChange={(e) => set({ day: Number(e.target.value) })}>
          {Array.from({ length: maxDay(v.lunar, v.month) }, (_, i) => <option key={i} value={i + 1}>{i + 1}일</option>)}
        </select>
      </div>
      {(v.lunar || needsStart) && (
        <p className="tx-meta" style={{ margin: 0 }}>
          {next ? `다가오는 날은 ${v.lunar ? '양력 ' : ''}${solarLabel(next)}이에요.` : v.lunar ? '이 날짜는 아직 양력으로 바꿀 수 없어요.' : '다가오는 날을 찾지 못했어요.'}
        </p>
      )}
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
