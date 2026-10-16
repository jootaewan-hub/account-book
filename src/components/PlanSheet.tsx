import { useEffect, useState } from 'react'
import { deleteAnniversary, deleteEvent, friendlyError, insertAnniversary, insertEvent, updateAnniversary, updateEvent } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import type { Anniversary, CalEvent, EventInput } from '../lib/types'
import { annivFromDate, AnniversaryForm } from './AnniversaryForm'
import { Sheet } from './Sheet'

/** 무엇을 열지: 고른 날짜에 새로 넣기, 일정 고치기, 기념일 고치기 */
export type PlanTarget =
  | { kind: 'new'; date: string }
  | { kind: 'event'; event: CalEvent }
  | { kind: 'anniv'; anniv: Anniversary }

interface Props {
  target: PlanTarget | null
  householdId: string
  today: string
  onEventsChanged: () => Promise<void>
  onAnnivsChanged: () => Promise<void>
  onClose: () => void
  toast: (msg: string) => void
}

/** 달력에서 일정·기념일을 넣고 고치는 시트 */
export function PlanSheet({ target, householdId, today, onEventsChanged, onAnnivsChanged, onClose, toast }: Props) {
  const [mode, setMode] = useState<'event' | 'anniv'>('event')
  useEffect(() => { if (target) setMode(target.kind === 'anniv' ? 'anniv' : 'event') }, [target])

  const isNew = target?.kind === 'new'
  const title = !target ? '' : isNew ? `${formatDateLong(target.date)}에 넣기` : target.kind === 'event' ? '일정 고치기' : '기념일 고치기'

  async function run(fn: () => Promise<void>, after: () => Promise<void>, ok: string) {
    try { await fn(); await after(); toast(ok); onClose() } catch (e) { toast(friendlyError(e)) }
  }

  return (
    <Sheet open={target !== null} title={title} onClose={onClose}>
      {target && isNew && (
        <div className="seg" role="group" aria-label="넣을 것">
          <button aria-pressed={mode === 'event'} onClick={() => setMode('event')}>일정</button>
          <button aria-pressed={mode === 'anniv'} onClick={() => setMode('anniv')}>기념일 (해마다)</button>
        </div>
      )}
      {target && mode === 'event' && target.kind !== 'anniv' && (
        <EventForm key={target.kind === 'event' ? target.event.id : `new-${target.date}`}
          initial={target.kind === 'event' ? target.event : { date: target.date, time: null, title: '', memo: null }}
          editing={target.kind === 'event'}
          onCancel={onClose}
          onSave={(v) => run(() => (target.kind === 'event' ? updateEvent(target.event.id, v) : insertEvent(householdId, v)),
            onEventsChanged, target.kind === 'event' ? '일정을 고쳤어요' : '일정을 넣었어요')}
          onDelete={target.kind === 'event' ? () => run(() => deleteEvent(target.event.id), onEventsChanged, '일정을 지웠어요') : undefined} />
      )}
      {target && mode === 'anniv' && target.kind !== 'event' && (
        <AnniversaryForm key={target.kind === 'anniv' ? target.anniv.id : `new-${target.date}`} today={today}
          editing={target.kind === 'anniv'}
          fromDate={target.kind === 'new' ? target.date : undefined}
          initial={target.kind === 'anniv'
            ? { name: target.anniv.name, kind: target.anniv.kind, lunar: target.anniv.lunar, month: target.anniv.month, day: target.anniv.day }
            : { name: '', kind: 'birthday', lunar: false, ...annivFromDate(target.date, false) }}
          onCancel={onClose}
          onSave={(v) => run(() => (target.kind === 'anniv' ? updateAnniversary(target.anniv.id, v) : insertAnniversary(householdId, v)),
            onAnnivsChanged, target.kind === 'anniv' ? '기념일을 고쳤어요' : '기념일을 넣었어요')}
          onDelete={target.kind === 'anniv' ? () => run(() => deleteAnniversary(target.anniv.id), onAnnivsChanged, '기념일을 지웠어요') : undefined} />
      )}
    </Sheet>
  )
}

function EventForm({ initial, editing, onSave, onCancel, onDelete }: {
  initial: EventInput
  editing: boolean
  onSave: (v: EventInput) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}) {
  const [v, setV] = useState<EventInput>({ date: initial.date, time: initial.time, title: initial.title, memo: initial.memo })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function submit() {
    if (!v.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return
    setBusy(true)
    try { await onSave({ ...v, title: v.title.trim(), memo: v.memo?.trim() || null }) } finally { setBusy(false) }
  }

  async function remove() {
    if (!onDelete) return
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try { await onDelete() } finally { setBusy(false) }
  }

  return (
    <form className="anniv-form plan-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div className="field">
        <label htmlFor="ev-title">무엇을</label>
        <input id="ev-title" className="input" placeholder="예: 치과 예약, 친구 결혼식" maxLength={40}
          value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor="ev-date">날짜</label>
          <input id="ev-date" type="date" className="input date-input" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ev-time">시간</label>
          <input id="ev-time" type="time" className="input date-input" value={v.time ?? ''} disabled={v.time === null}
            onChange={(e) => setV({ ...v, time: e.target.value || null })} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={v.time === null} onChange={(e) => setV({ ...v, time: e.target.checked ? null : '09:00' })} />
        하루 종일 (시간 없이)
      </label>
      <div className="field">
        <label htmlFor="ev-memo">메모 (선택)</label>
        <input id="ev-memo" className="input" maxLength={200} value={v.memo ?? ''} onChange={(e) => setV({ ...v, memo: e.target.value })} />
      </div>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <button type="button" className="ghost" onClick={onCancel}>취소</button>
        <button className="primary" disabled={busy || !v.title.trim()}>{editing ? '고치기' : '넣기'}</button>
      </div>
      {editing && onDelete && (
        <button type="button" className="danger" disabled={busy} onClick={remove}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제'}</button>
      )}
    </form>
  )
}
