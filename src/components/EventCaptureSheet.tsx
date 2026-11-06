import { useEffect, useRef, useState } from 'react'
import { deleteEvent, deleteEvents, fetchEvents, friendlyError, insertEvents, updateEvent } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import { analyzeEvents, analyzeEventText, canAutoSave, EVENT_PHOTOS_MAX, eventDateRange, eventInput, eventRevision, toEventDrafts, type EventDraft } from '../lib/eventCapture'
import { fileToJpeg, type PreparedImage } from '../lib/image'
import { modelLabel, SmartError } from '../lib/smart'
import type { CalEvent, EventInput } from '../lib/types'
import { eventScopeLabel, EventScopeSeg, EventScopeTag } from './EventScope'
import { CloseBold } from './Icons'
import { PlaceFields } from './PlaceFields'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  today: string
  householdId: string
  /** 넣은 뒤: 넣은 건수와 가장 이른 날짜(달력을 그 날로 옮긴다) */
  onSaved: (count: number, firstDate: string) => Promise<void>
  onRevised?: (notice: 'change' | 'cancel', date: string) => Promise<void>
  /** 직접 넣기로 바꾸기: 일정 넣기 시트를 연다 */
  onManual: () => void
  onClose: () => void
}

/** done: 문자로 바로 넣은 뒤(넣은 것과 되돌리기, D-046) */
type Stage = 'input' | 'loading' | 'review' | 'done'
/** 읽을 것: 캡처 사진 또는 붙여넣은 문자(D-046) */
type Src = 'photo' | 'text'

const TEXT_SAMPLE = '[○○학회] 2026 추계 심포지엄 안내\n일시: 11월 21일(토) 09:00~17:00\n장소: 코엑스 컨퍼런스룸 401호\n사전등록 필수, 평점 6점'

/**
 * 일정·예약 캡처나 문자를 읽어 달력 일정으로 넣는 시트(D-039, D-046). 캡처는 넣기 전에 확인하고,
 * 문자는 확인할 것이 없으면 바로 넣는다(확인 문장·같은 일정이 있으면 확인 화면).
 */
export function EventCaptureSheet({ open, today, householdId, onSaved, onRevised, onManual, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('input')
  const [src, setSrc] = useState<Src>('photo')
  const [text, setText] = useState('')
  // 문자로 바로 넣은 일정(되돌리기용 id와 넣은 값)
  const [saved, setSaved] = useState<{ ids: string[]; list: EventInput[] } | null>(null)
  const [images, setImages] = useState<PreparedImage[]>([])
  const [drafts, setDrafts] = useState<EventDraft[]>([])
  const [revised, setRevised] = useState<Record<string, string>>({})
  const [note, setNote] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  // 다시 읽으면 카드를 새로 만든다(초안 key '0'이 같아도 앞 결과의 칸 상태가 남지 않게)
  const [round, setRound] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // 읽기 요청 번호. 시트를 닫거나 다시 열면 바뀌어, 늦게 끝난 이전 결과는 버린다(닫은 뒤에는 바로 넣기도 하지 않는다)
  const reqRef = useRef(0)

  useEffect(() => {
    reqRef.current++
    if (!open) return
    setStage('input'); setDrafts([]); setRevised({}); setNote(null); setModel(null); setErr(''); setBusy(false); setPreparing(false); setText(''); setSaved(null)
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.preview)); return [] })
  }, [open])

  async function addFiles(list: FileList | null) {
    const files = [...(list ?? [])]
    if (!files.length) return
    const room = EVENT_PHOTOS_MAX - images.length
    if (room <= 0) return setErr(`캡처는 최대 ${EVENT_PHOTOS_MAX}장까지예요.`)
    setErr(''); setPreparing(true)
    const added: PreparedImage[] = []
    let failed = 0
    // 큰 사진 여러 장을 한꺼번에 풀면 아이폰 메모리가 모자랄 수 있어 한 장씩 처리한다
    for (const f of files.slice(0, room)) {
      try { added.push(await fileToJpeg(f)) } catch { failed++ }
    }
    setImages((prev) => [...prev, ...added])
    setPreparing(false)
    if (files.length > room) setErr(`캡처는 최대 ${EVENT_PHOTOS_MAX}장까지라 ${room}장만 넣었어요.`)
    else if (failed) setErr(`${failed}장은 읽지 못했어요. 다른 사진으로 해 보세요.`)
  }

  function removeImage(i: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, j) => j !== i)
    })
    setErr('')
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) { setText(t); setErr('') } else setErr('클립보드가 비어 있어요.')
    } catch {
      setErr('아래 칸을 길게 눌러 붙여넣어 주세요.')
    }
  }

  async function read() {
    if (src === 'photo' ? !images.length : !text.trim()) return
    const id = ++reqRef.current
    setStage('loading'); setErr('')
    try {
      const res = src === 'text'
        ? await analyzeEventText(text, today)
        : await analyzeEvents(images.map(({ media_type, data, width, height }) => ({ media_type, data, width, height })), today)
      if (id !== reqRef.current) return
      if (!res.events.length) { setErr(res.note || (src === 'text' ? '문자에서 일정을 찾지 못했어요.' : '캡처에서 일정을 찾지 못했어요.')); setStage('input'); return }
      // 기존 일정은 변경·취소를 적용할 때 꼭 필요하다.
      const hasRevision = res.events.some((e) => e.notice === 'change' || e.notice === 'cancel')
      const range = eventDateRange(res.events, today)
      const existing = range ? await fetchEvents(householdId, range.from, range.to).catch((e: unknown) => {
        if (hasRevision) throw e
        return []
      }) : []
      if (id !== reqRef.current) return
      const ds = toEventDrafts(res.events, existing)
      setDrafts(ds); setRevised({}); setRound(id); setModel(modelLabel(res.model))
      // 문자는 확인할 것이 없고 원문과 맞으면(날짜가 원문에 있음, 인터넷 주소 없음) 바로 넣고, 넣은 것을 보이며 되돌리기를 둔다
      if (src === 'text' && canAutoSave(ds, res.note, text)) {
        const list = ds.map((d) => eventInput(d) as EventInput)
        const ids = await insertEvents(householdId, list)
        // 넣는 동안 시트를 닫았으면 넣은 것을 알린다(알림과 달력 이동)
        if (id !== reqRef.current) return void onSaved(list.length, list.map((v) => v.date).sort()[0])
        setSaved({ ids, list }); setNote(null); setStage('done')
        return
      }
      setNote([src === 'text' && !hasRevision ? '확인할 것이 있어 바로 넣지 않았어요. 고칠 것을 고친 뒤 넣어 주세요.' : null, res.note].filter(Boolean).join('\n') || null)
      setStage('review')
    } catch (e) {
      if (id !== reqRef.current) return
      setErr(e instanceof SmartError ? e.message : friendlyError(e)); setStage('input')
    }
  }

  // 바로 넣은 뒤 '확인'·닫기: 달력을 그 날로 옮기고 알림
  async function finish() {
    if (!saved) return onClose()
    await onSaved(saved.list.length, saved.list.map((v) => v.date).sort()[0])
  }

  // 되돌리기: 방금 넣은 일정을 지우고 확인 화면으로(고쳐서 넣거나 닫는다)
  async function undo() {
    if (!saved) return
    setBusy(true); setErr('')
    try {
      await deleteEvents(saved.ids)
      setSaved(null); setNote('넣은 일정을 지웠어요. 고친 뒤 넣거나 닫아 주세요.'); setStage('review')
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const patch = (key: string, p: Partial<EventDraft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)))
  const chosen = drafts.filter((d) => !d.revision && d.include)

  async function revise(d: EventDraft, existing: CalEvent) {
    if (busy || !d.revision || Object.values(revised).includes(existing.id)) return
    const { notice } = d.revision
    const change = eventRevision(d, existing)
    if (notice === 'change' && !change) return
    const request = reqRef.current
    setBusy(true); setErr('')
    try {
      if (notice === 'cancel') await deleteEvent(existing.id, existing.updated_at ?? null)
      else if (change) await updateEvent(existing.id, change, existing.updated_at ?? null)
      if (request === reqRef.current) setRevised((prev) => ({ ...prev, [d.key]: existing.id }))
      await onRevised?.(notice, notice === 'change' && change ? change.date : existing.date)
    } catch (e) {
      if (request === reqRef.current) setErr(friendlyError(e))
    } finally {
      if (request === reqRef.current) setBusy(false)
    }
  }

  async function save() {
    const list: EventInput[] = []
    for (const d of chosen) {
      const v = eventInput(d)
      if (typeof v === 'string') return setErr(v)
      list.push(v)
    }
    setBusy(true); setErr('')
    try {
      await insertEvents(householdId, list)
      await onSaved(list.length, list.map((v) => v.date).sort()[0])
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={stage === 'review' && drafts.every((d) => d.revision) ? '예약 변경·취소 확인' : '캡처·문자로 일정 넣기'}
      onClose={stage === 'done' ? () => void finish() : onClose}>
      {stage === 'done' && saved && (
        <div className="ev-done">
          <p className="lead" role="status">일정 {saved.list.length}건을 넣었어요</p>
          <ul className="ev-done-list">
            {saved.list.map((v, i) => (
              <li key={i}>
                <b>{v.title}</b>
                <span className="num">{formatDateLong(v.date)}{v.time ? ` ${v.time}` : ' 하루 종일'}</span>
                {(v.place || v.address) && <span>{v.place || v.address}</span>}
                {v.memo && <span className="ev-done-memo">{v.memo}</span>}
              </li>
            ))}
          </ul>
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={busy} onClick={() => void finish()}>확인</button>
          <button className="ghost" disabled={busy} onClick={() => void undo()}>{busy ? '지우는 중…' : '되돌리기'}</button>
          {model && <p className="tx-meta">{model}로 읽었어요</p>}
        </div>
      )}
      {stage === 'input' && (
        <div className="seg" role="group" aria-label="읽을 것">
          <button type="button" aria-pressed={src === 'photo'} onClick={() => { setSrc('photo'); setErr('') }}>캡처 사진</button>
          <button type="button" aria-pressed={src === 'text'} onClick={() => { setSrc('text'); setErr('') }}>문자 붙여넣기</button>
        </div>
      )}
      {stage === 'input' && src === 'text' && (
        <>
          <p className="note">
            학회·심포지엄 안내, 호텔·식당 예약 문자처럼 일정이 담긴 문자를 복사해서 붙여넣으세요. 날짜·시간·장소를 읽어 일정으로 넣고,
            날짜를 못 읽었거나 지난 날짜처럼 확인할 것이 있으면 넣기 전에 보여 드려요.
          </p>
          <button className="ghost" onClick={() => void pasteFromClipboard()}>클립보드에서 붙여넣기</button>
          <textarea className="input smart-text" aria-label="붙여넣을 문자" placeholder={TEXT_SAMPLE} value={text} maxLength={6000}
            onChange={(e) => setText(e.target.value)} />
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={!text.trim()} onClick={() => void read()}>읽고 일정 넣기</button>
        </>
      )}
      {stage === 'input' && src === 'photo' && (
        <>
          <p className="note">
            식당·병원 예약 확인, 모임 공지, 공연·숙박 예약처럼 날짜가 보이는 화면을 캡처해서 고르세요. 읽은 날짜·시간·장소를 넣기 전에 확인하고 고칠 수 있어요.
            같은 예약을 여러 장에 나눠 찍었으면 모두 넣으세요(최대 {EVENT_PHOTOS_MAX}장).
          </p>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
          {images.length > 0 && (
            <div className="smart-previews" aria-label={`고른 캡처 ${images.length}장`}>
              {images.map((im, i) => (
                <div key={im.preview} className="pv">
                  <img src={im.preview} alt={`고른 캡처 ${i + 1}`} />
                  <button className="pv-x" onClick={() => removeImage(i)} aria-label={`캡처 ${i + 1} 빼기`}><CloseBold /></button>
                </div>
              ))}
            </div>
          )}
          <p className="err" role="alert">{err}</p>
          {images.length === 0 ? (
            <button className="primary" disabled={preparing} onClick={() => fileRef.current?.click()}>
              {preparing ? '사진 준비 중…' : '캡처 고르기'}
            </button>
          ) : (
            <>
              <button className="primary" disabled={preparing} onClick={() => void read()}>
                {preparing ? '사진 준비 중…' : `캡처 ${images.length}장 읽기`}
              </button>
              {images.length < EVENT_PHOTOS_MAX && (
                <button className="ghost" disabled={preparing} onClick={() => fileRef.current?.click()}>
                  캡처 더 넣기 ({images.length}/{EVENT_PHOTOS_MAX})
                </button>
              )}
            </>
          )}
        </>
      )}

      {stage === 'loading' && (
        <div className="smart-loading" role="status">
          {src === 'photo' && <div className="smart-previews">{images.map((im) => <img key={im.preview} src={im.preview} alt="고른 캡처" />)}</div>}
          <p className="lead shimmer">{src === 'text' ? '문자에서 날짜와 시간을 읽는 중이에요' : `캡처 ${images.length}장에서 날짜와 시간을 읽는 중이에요`}</p>
          <p className="tx-meta" style={{ justifyContent: 'center' }}>보통 5~15초 걸려요.</p>
        </div>
      )}

      {stage === 'review' && (
        <>
          {note && <p className="note">{note}</p>}
          {drafts.map((d) => d.revision
            ? <EventRevisionCard key={`${round}:${d.key}`} d={d} revision={d.revision} busy={busy}
                revised={revised} onConfirm={(event) => void revise(d, event)} />
            : <EventDraftCard key={`${round}:${d.key}`} d={d} onChange={(p) => patch(d.key, p)} />)}
          <p className="err" role="alert">{err}</p>
          {drafts.some((d) => !d.revision) && <button className="primary" disabled={busy || !chosen.length} onClick={() => void save()}>
            {busy ? '넣는 중…' : chosen.length ? `일정 ${chosen.length}건 넣기` : '넣을 일정을 고르세요'}
          </button>}
          <button className="ghost" disabled={busy} onClick={() => { setStage('input'); setErr('') }}>다시 하기</button>
          {model && <p className="tx-meta">{model}로 읽었어요</p>}
        </>
      )}

      {stage !== 'loading' && stage !== 'done' && (stage !== 'review' || drafts.some((d) => !d.revision))
        && <button className="link-btn" disabled={busy} onClick={onManual}>직접 넣기로 바꾸기</button>}
    </Sheet>
  )
}

function eventWhen(e: Pick<CalEvent, 'date' | 'time' | 'end_on'>): string {
  const date = (d: string) => `${d.slice(0, 4)}년 ${formatDateLong(d)}`
  const range = e.end_on && e.end_on !== e.date ? ` ~ ${date(e.end_on)}` : ''
  return `${date(e.date)}${e.time ? ` ${e.time}` : ' 하루 종일'}${range}`
}

function EventRevisionCard({ d, revision, busy, revised, onConfirm }: {
  d: EventDraft
  revision: NonNullable<EventDraft['revision']>
  busy: boolean
  revised: Record<string, string>
  onConfirm: (event: CalEvent) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const available = revision.candidates.filter((event) => !Object.values(revised).includes(event.id))
  const selected = available.find((event) => event.id === selectedId)
  const change = selected ? eventRevision(d, selected) : null
  const cancel = revision.notice === 'cancel'
  const label = cancel ? '취소' : '변경'
  const applied = Boolean(revised[d.key])
  return (
    <section className="card draft ev-draft">
      <h3 className="lead">{label} 안내 · {d.title}</h3>
      {applied ? <p className="note" role="status">{cancel ? '일정을 지웠어요.' : '일정을 바꿨어요.'}</p> : <>
        {d.warnings.filter((w) => !w.startsWith(`${label} 안내로 보여요`)).map((w) => <p key={w} className="banner">{w}</p>)}
        {(d.date || d.time) && <p className="note">
          {cancel ? '취소된 예약' : '안내에 적힌 새 일정'} · {d.date && formatDateLong(d.date)} {d.time}
        </p>}
        {available.length === 0 ? <p className="note">맞는 기존 일정을 찾지 못했어요.</p> : <>
          <div className="field">
            <label htmlFor={`ec-${d.key}-original`}>기존 일정 선택</label>
            <select id={`ec-${d.key}-original`} className="input" disabled={busy} value={selected?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">달력에서 일정 고르기</option>
              {available.map((e) => <option key={e.id} value={e.id}>{eventWhen(e)} · {e.scope !== 'shared' && `${eventScopeLabel(e.scope)} · `}{e.title}</option>)}
            </select>
          </div>
          {selected && <>
            <div className="field">
              <b>{selected.title} <EventScopeTag scope={selected.scope} /></b>
              {(selected.place || selected.address) && <span>{selected.place || selected.address}</span>}
              {selected.memo && <span>{selected.memo}</span>}
            </div>
            <div className="row2">
              <div className="field">
                <b>{label} 전</b>
                <span className="num">{eventWhen(selected)}</span>
              </div>
              <div className="field">
                <b>{label} 후</b>
                {cancel ? <span>달력에서 이 일정을 지워요.</span> : change
                  ? <span className="num">{eventWhen({ ...selected, ...change })}</span>
                  : <span>바꿀 날짜나 시간이 없어요.</span>}
              </div>
            </div>
          </>}
          <button className="primary" disabled={busy || !selected || (!cancel && !change)} onClick={() => selected && onConfirm(selected)}>
            {cancel ? '확인하고 일정 지우기' : '확인하고 일정 바꾸기'}
          </button>
        </>}
      </>}
    </section>
  )
}

function EventDraftCard({ d, onChange }: { d: EventDraft; onChange: (p: Partial<EventDraft>) => void }) {
  const id = (f: string) => `ec-${d.key}-${f}`
  return (
    <div className={`card draft ev-draft${d.include ? '' : ' off'}`}>
      <label className="draft-head">
        <input type="checkbox" checked={d.include} aria-label={`${d.title.trim() || '이 일정'} 넣기`} onChange={(e) => onChange({ include: e.target.checked })} />
        <span aria-hidden="true">{d.include ? '넣기' : '빼기'}</span>
        <b className="num">{d.date ? formatDateLong(d.date) : '날짜 없음'}{d.date && d.time ? ` ${d.time}` : ''}</b>
      </label>
      {d.warnings.map((w) => <p key={w} className="banner">{w}</p>)}
      <div className="field">
        <label htmlFor={id('title')}>무엇을</label>
        <input id={id('title')} className="input" maxLength={40} value={d.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <EventScopeSeg value={d.scope} onChange={(scope) => onChange({ scope })} />
      <div className="row2">
        <div className="field">
          <label htmlFor={id('date')}>날짜</label>
          <input id={id('date')} type="date" className="input date-input" value={d.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={id('time')}>시간</label>
          <input id={id('time')} type="time" className="input date-input" value={d.time ?? ''} disabled={d.time === null}
            onChange={(e) => onChange({ time: e.target.value || null })} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={d.time === null} onChange={(e) => onChange({ time: e.target.checked ? null : '09:00' })} />
        하루 종일 (시간 없이)
      </label>
      <PlaceFields idPrefix={`ec-${d.key}`} value={d} onChange={(p) => onChange({
        ...(p.place !== undefined ? { place: p.place ?? '' } : {}),
        ...(p.address !== undefined ? { address: p.address ?? '' } : {}),
        ...(p.lat !== undefined ? { lat: p.lat, lng: p.lng ?? null } : {}),
      })} />
      <div className="field">
        <label htmlFor={id('memo')}>메모</label>
        <textarea id={id('memo')} className="input ev-memo" maxLength={200} rows={3} value={d.memo} onChange={(e) => onChange({ memo: e.target.value })} />
      </div>
    </div>
  )
}
