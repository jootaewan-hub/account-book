import { useEffect, useState } from 'react'
import { deleteAnniversary, deleteEvent, friendlyError, insertAnniversary, insertEvent, updateAnniversary, updateEvent } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import { annivCategories, annivInput, newAnnivInput } from '../lib/anniversaries'
import { eventEffect, eventPriority, EFFECTS, isRange, rangeDays, rangeError, rangeLabel } from '../lib/events'
import { lsGet, lsSet } from '../lib/localPrefs'
import type { Anniversary, CalEvent, EventEffect, EventInput } from '../lib/types'
import { annivFromDate, AnniversaryForm } from './AnniversaryForm'
import { EventPriorityFields } from './EventPriority'
import { EventScopeSeg } from './EventScope'
import { PlaceFields } from './PlaceFields'
import { Sheet } from './Sheet'

/** 무엇을 열지: 고른 날짜에 새로 넣기, 일정 고치기, 기념일 고치기 */
export type PlanTarget =
  | { kind: 'new'; date: string; /** 달력의 넣기 칸에 적던 이름(D-054) */ title?: string }
  | { kind: 'event'; event: CalEvent }
  | { kind: 'anniv'; anniv: Anniversary }

interface Props {
  target: PlanTarget | null
  householdId: string
  today: string
  /** 카테고리 고르기에 쓰는 가구의 기념일 */
  annivs: Anniversary[]
  onEventsChanged: () => Promise<void>
  onAnnivsChanged: () => Promise<void>
  onClose: () => void
  toast: (msg: string) => void
}

/** 달력에서 일정·기념일을 넣고 고치는 시트 */
export function PlanSheet({ target, householdId, today, annivs, onEventsChanged, onAnnivsChanged, onClose, toast }: Props) {
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
          <button aria-pressed={mode === 'anniv'} onClick={() => setMode('anniv')}>기념일 (반복)</button>
        </div>
      )}
      {target && mode === 'event' && target.kind !== 'anniv' && (
        <EventForm key={target.kind === 'event' ? target.event.id : `new-${target.date}`}
          initial={target.kind === 'event' ? target.event : { date: target.date, time: null, title: target.title ?? '', memo: null, place: null, address: null, lat: null, lng: null, scope: 'shared' }}
          editing={target.kind === 'event'}
          onCancel={onClose}
          onSave={(v) => run(() => (target.kind === 'event' ? updateEvent(target.event.id, v) : insertEvent(householdId, v)),
            onEventsChanged, target.kind === 'event' ? '일정을 고쳤어요' : '일정을 넣었어요')}
          onDelete={target.kind === 'event' ? () => run(() => deleteEvent(target.event.id), onEventsChanged, '일정을 지웠어요') : undefined} />
      )}
      {target && mode === 'anniv' && target.kind !== 'event' && (
        <AnniversaryForm key={target.kind === 'anniv' ? target.anniv.id : `new-${target.date}`} today={today}
          editing={target.kind === 'anniv'} categories={annivCategories(annivs)}
          fromDate={target.kind === 'new' ? target.date : undefined}
          initial={target.kind === 'anniv' ? annivInput(target.anniv) : newAnnivInput(target.date, annivFromDate(target.date, false))}
          onCancel={onClose}
          onSave={(v) => run(() => (target.kind === 'anniv' ? updateAnniversary(target.anniv.id, v) : insertAnniversary(householdId, v)),
            onAnnivsChanged, target.kind === 'anniv' ? '기념일을 고쳤어요' : '기념일을 넣었어요')}
          onDelete={target.kind === 'anniv' ? () => run(() => deleteAnniversary(target.anniv.id), onAnnivsChanged, '기념일을 지웠어요') : undefined} />
      )}
    </Sheet>
  )
}

/** 마지막으로 고른 표시 효과(기기마다 기억, D-054). 새 일정을 중요·꼭으로 바꾸면 이 효과가 먼저 골라져 있다 */
const LAST_EFFECT = 'ab:lastEventEffect'
function lastEffect(): EventEffect {
  const v = lsGet(LAST_EFFECT) as EventEffect | null
  return v && EFFECTS.includes(v) ? v : 'outline'
}

function EventForm({ initial, editing, onSave, onCancel, onDelete }: {
  initial: EventInput
  editing: boolean
  onSave: (v: EventInput) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}) {
  const [v, setV] = useState<EventInput>({ date: initial.date, time: initial.time, title: initial.title, memo: initial.memo,
    place: initial.place ?? null, address: initial.address ?? null, lat: initial.lat ?? null, lng: initial.lng ?? null, scope: initial.scope ?? 'shared',
    end_on: isRange(initial) ? initial.end_on : null, priority: eventPriority(initial),
    effect: eventPriority(initial) === 'normal' ? lastEffect() : eventEffect(initial) })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 끝나는 날이 시작보다 앞이거나 1년을 넘으면 넣지 못하게 막고 까닭을 적는다(날짜를 몰래 고치지 않는다)
  const rangeErr = rangeError(v.date, v.end_on)
  const ranged = !rangeErr && isRange(v)

  async function submit() {
    if (!v.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || rangeErr) return
    setBusy(true)
    try {
      if (v.priority !== 'normal' && v.effect) lsSet(LAST_EFFECT, v.effect)
      // 끝나는 날이 시작과 같으면 하루 일정으로 넣는다
      await onSave({ ...v, title: v.title.trim(), memo: v.memo?.trim() || null, place: v.place?.trim() || null, address: v.address?.trim() || null,
        end_on: isRange(v) ? v.end_on : null })
    } finally { setBusy(false) }
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
      <EventScopeSeg value={v.scope} onChange={(scope) => setV({ ...v, scope })} />
      {/* 기간(D-054): 끝나는 날을 비우면 하루 일정. 시작보다 앞이면 막는다 */}
      <div className="row2">
        <div className="field">
          <label htmlFor="ev-date">시작하는 날</label>
          <input id="ev-date" type="date" className="input date-input" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ev-end">끝나는 날 (선택)</label>
          <input id="ev-end" type="date" className={`input date-input${rangeErr ? ' bad' : ''}`} min={v.date} value={v.end_on ?? ''}
            aria-invalid={rangeErr ? true : undefined} aria-describedby="ev-range-note" onChange={(e) => setV({ ...v, end_on: e.target.value || null })} />
        </div>
      </div>
      <div className="range-note">
        <p id="ev-range-note" className={rangeErr ? 'err' : undefined} role={rangeErr ? 'alert' : undefined}>
          {rangeErr ?? (ranged ? <><b className="num">{rangeLabel(v)}</b>, <span className="num">{rangeDays(v)}일 동안</span></> : '하루 일정이에요. 여러 날이면 끝나는 날을 골라 주세요.')}
        </p>
        {v.end_on && <button type="button" className="link-btn" onClick={() => setV({ ...v, end_on: null })}>끝나는 날 지우기</button>}
      </div>
      <div className="row2 ev-time-row">
        <div className="field">
          <label htmlFor="ev-time">{ranged ? '시작 시간' : '시간'}</label>
          <input id="ev-time" type="time" className="input date-input" value={v.time ?? ''} disabled={v.time === null}
            onChange={(e) => setV({ ...v, time: e.target.value || null })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={v.time === null} onChange={(e) => setV({ ...v, time: e.target.checked ? null : '09:00' })} />
          하루 종일 (시간 없이)
        </label>
      </div>
      <EventPriorityFields priority={v.priority ?? 'normal'} effect={v.effect ?? 'outline'} sample={v.title}
        onChange={(p) => setV({ ...v, ...p })} />
      <PlaceFields idPrefix="ev" value={v} onChange={(p) => setV({ ...v, ...p })} />
      <div className="field">
        <label htmlFor="ev-memo">메모 (선택)</label>
        <input id="ev-memo" className="input" maxLength={200} value={v.memo ?? ''} onChange={(e) => setV({ ...v, memo: e.target.value })} />
      </div>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <button type="button" className="ghost" onClick={onCancel}>취소</button>
        <button className="primary" disabled={busy || !v.title.trim() || !!rangeErr}>{editing ? '고치기' : '넣기'}</button>
      </div>
      {editing && onDelete && (
        <button type="button" className="danger" disabled={busy} onClick={remove}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제'}</button>
      )}
    </form>
  )
}
