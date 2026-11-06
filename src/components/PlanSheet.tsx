import { useEffect, useRef, useState } from 'react'
import { deleteAnniversary, deleteEvent, friendlyError, insertAnniversary, insertEvent, skipEventOccurrence, updateAnniversary, updateEvent } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import { annivCategories, annivInput, newAnnivInput } from '../lib/anniversaries'
import { eventEffect, eventPriority, EFFECTS, isRange, rangeDays, rangeError, rangeLabel } from '../lib/events'
import { lsGet, lsSet } from '../lib/localPrefs'
import type { Anniversary, CalEvent, EventEffect, EventInput, Member } from '../lib/types'
import { annivFromDate, AnniversaryForm } from './AnniversaryForm'
import { EventPriorityFields } from './EventPriority'
import { EventReminderFields } from './EventReminderFields'
import { EventScopeSeg } from './EventScope'
import { EventPayments } from './EventPayments'
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
  members?: Member[]
  userId?: string
  onOpenTransaction?: (id: string) => void
  onEventsChanged: () => Promise<void>
  onAnnivsChanged: () => Promise<void>
  onClose: () => void
  toast: (msg: string) => void
}

/** 달력에서 일정·기념일을 넣고 고치는 시트 */
export function PlanSheet({ target, householdId, today, annivs, members = [], userId, onOpenTransaction, onEventsChanged, onAnnivsChanged, onClose, toast }: Props) {
  const [mode, setMode] = useState<'event' | 'anniv'>('event')
  const paymentSection = useRef<HTMLElement>(null)
  useEffect(() => { if (target) setMode(target.kind === 'anniv' ? 'anniv' : 'event') }, [target])

  const isNew = target?.kind === 'new'
  const title = !target ? '' : isNew ? `${formatDateLong(target.date)}에 넣기` : target.kind === 'event' ? '일정 고치기' : '기념일 고치기'

  async function run(fn: () => Promise<void>, after: () => Promise<void>, ok: string) {
    try { await fn(); await after(); toast(ok); onClose() } catch (e) { toast(friendlyError(e)) }
  }

  return (
    <Sheet open={target !== null} title={title} onClose={onClose}>
      {target?.kind === 'event' && onOpenTransaction && (
        <button type="button" className="link-btn plan-payments-jump" onClick={() => {
          paymentSection.current?.scrollIntoView({ block: 'start' })
          paymentSection.current?.focus({ preventScroll: true })
        }}>일정 결제 보기</button>
      )}
      {target && isNew && (
        <div className="seg" role="group" aria-label="넣을 것">
          <button aria-pressed={mode === 'event'} onClick={() => setMode('event')}>일정</button>
          <button aria-pressed={mode === 'anniv'} onClick={() => setMode('anniv')}>기념일 (반복)</button>
        </div>
      )}
      {target && mode === 'event' && target.kind !== 'anniv' && (
        <EventForm key={target.kind === 'event' ? target.event.id : `new-${target.date}`}
          initial={target.kind === 'event' ? { ...target.event, date: target.event.series_start ?? target.event.date } : { date: target.date, time: null, title: target.title ?? '', memo: null, place: null, address: null, lat: null, lng: null, scope: 'shared' }}
          editing={target.kind === 'event'}
          members={members} userId={userId}
          occurrence={target.kind === 'event' && target.event.series_start ? target.event.date : undefined}
          onSkip={target.kind === 'event' && target.event.series_start
            ? () => run(() => skipEventOccurrence(target.event.id, target.event.date), onEventsChanged, '이날 일정만 건너뛰었어요') : undefined}
          onCancel={onClose}
          onSave={(v) => run(() => (target.kind === 'event' ? updateEvent(target.event.id, v) : insertEvent(householdId, v)),
            onEventsChanged, target.kind === 'event' ? '일정을 고쳤어요' : '일정을 넣었어요')}
          onDelete={target.kind === 'event' ? () => run(() => deleteEvent(target.event.id), onEventsChanged, '일정을 지웠어요') : undefined} />
      )}
      {target?.kind === 'event' && onOpenTransaction && (
        <EventPayments key={target.event.id} householdId={householdId} eventId={target.event.id}
          eventDate={target.event.date} today={today} onOpenTransaction={onOpenTransaction} sectionRef={paymentSection} />
      )}
      {target && mode === 'anniv' && target.kind !== 'event' && (
        <AnniversaryForm key={target.kind === 'anniv' ? target.anniv.id : `new-${target.date}`} today={today}
          editing={target.kind === 'anniv'} categories={annivCategories(annivs)}
          reminderMembers={members} reminderUserId={userId}
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

function EventForm({ initial, editing, members, userId, occurrence, onSkip, onSave, onCancel, onDelete }: {
  initial: EventInput
  editing: boolean
  members: Member[]
  userId?: string
  occurrence?: string
  onSkip?: () => Promise<void>
  onSave: (v: EventInput) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}) {
  const [v, setV] = useState<EventInput>({ date: initial.date, time: initial.time, title: initial.title, memo: initial.memo,
    place: initial.place ?? null, address: initial.address ?? null, lat: initial.lat ?? null, lng: initial.lng ?? null, scope: initial.scope ?? 'shared',
    end_on: isRange(initial) ? initial.end_on : null, priority: eventPriority(initial),
    effect: eventPriority(initial) === 'normal' ? lastEffect() : eventEffect(initial),
    repeat_weeks: initial.repeat_weeks ?? null, repeat_until: initial.repeat_until ?? null,
    reminder_offset_minutes: initial.reminder_offset_minutes ?? null, reminder_recipient: initial.reminder_recipient ?? null })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)

  // 끝나는 날이 시작보다 앞이거나 1년을 넘으면 넣지 못하게 막고 까닭을 적는다(날짜를 몰래 고치지 않는다)
  const rangeErr = rangeError(v.date, v.end_on)
  const ranged = !rangeErr && isRange(v)
  const repeatError = v.repeat_weeks && v.repeat_until && v.repeat_until < v.date ? '반복 종료일이 시작하는 날보다 앞이에요.' : null

  async function submit() {
    if (!v.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || rangeErr || repeatError) return
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

  async function skip() {
    if (!onSkip || busy) return
    if (!confirmSkip) { setConfirmSkip(true); return }
    setBusy(true)
    try { await onSkip() } finally { setBusy(false) }
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
          <input id="ev-end" type="date" disabled={Boolean(v.repeat_weeks)} className={`input date-input${rangeErr ? ' bad' : ''}`} min={v.date} value={v.end_on ?? ''}
            aria-invalid={rangeErr ? true : undefined} aria-describedby="ev-range-note" onChange={(e) => setV({ ...v, end_on: e.target.value || null })} />
        </div>
      </div>
      <div className="range-note">
        <p id="ev-range-note" className={rangeErr ? 'err' : undefined} role={rangeErr ? 'alert' : undefined}>
          {rangeErr ?? (ranged ? <><b className="num">{rangeLabel(v)}</b>, <span className="num">{rangeDays(v)}일 동안</span></> : v.repeat_weeks ? '반복 일정은 하루씩 표시해요.' : '하루 일정이에요. 여러 날이면 끝나는 날을 골라 주세요.')}
        </p>
        {v.end_on && <button type="button" className="link-btn" onClick={() => setV({ ...v, end_on: null })}>끝나는 날 지우기</button>}
      </div>
      <div className="row2 event-repeat-fields">
        <label className="field">반복<select className="input" value={v.repeat_weeks ?? ''} disabled={ranged}
          onChange={(e) => { const weeks = e.target.value === '2' ? 2 : e.target.value === '1' ? 1 : null; setV({ ...v, repeat_weeks: weeks, repeat_until: weeks ? v.repeat_until : null, end_on: null }) }}>
          <option value="">반복 없음</option><option value="1">매주</option><option value="2">격주</option>
        </select></label>
        {v.repeat_weeks && <label className="field">반복 종료일 (선택)<input className="input" type="date" min={v.date} value={v.repeat_until ?? ''}
          onChange={(e) => setV({ ...v, repeat_until: e.target.value || null })} /></label>}
      </div>
      {repeatError && <p className="err" role="alert">{repeatError}</p>}
      {occurrence && <p className="plan-note">{formatDateLong(occurrence)} 회차를 보고 있어요. 고치기는 반복 일정 전체에 적용돼요.</p>}
      {onSkip && <button type="button" className="ghost" disabled={busy} onClick={() => void skip()}>{confirmSkip ? '한 번 더 눌러 이날만 건너뛰기' : '이번 한 번만 건너뛰기'}</button>}
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
      {userId && eventPriority(v) !== 'normal' && <EventReminderFields value={v} members={members} userId={userId} onChange={(patch) => setV({ ...v, ...patch })} />}
      <PlaceFields idPrefix="ev" value={v} onChange={(p) => setV({ ...v, ...p })} />
      <div className="field">
        <label htmlFor="ev-memo">메모 (선택)</label>
        <input id="ev-memo" className="input" maxLength={200} value={v.memo ?? ''} onChange={(e) => setV({ ...v, memo: e.target.value })} />
      </div>
      <div className="form-grid" style={{ marginTop: 0 }}>
        <button type="button" className="ghost" onClick={onCancel}>취소</button>
        <button className="primary" disabled={busy || !v.title.trim() || !!rangeErr || !!repeatError}>{editing ? '고치기' : '넣기'}</button>
      </div>
      {editing && onDelete && (
        <button type="button" className="danger" disabled={busy} onClick={remove}>{confirmDelete ? '한 번 더 누르면 지워요' : occurrence ? '반복 일정 전체 삭제' : '삭제'}</button>
      )}
    </form>
  )
}
