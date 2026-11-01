import { useEffect, useRef, useState } from 'react'
import { fetchEvents, friendlyError, insertEvents } from '../lib/api'
import { formatDateLong } from '../lib/dates'
import { analyzeEvents, EVENT_PHOTOS_MAX, eventDateRange, eventInput, toEventDrafts, type EventDraft } from '../lib/eventCapture'
import { fileToJpeg, type PreparedImage } from '../lib/image'
import { modelLabel, SmartError } from '../lib/smart'
import type { EventInput } from '../lib/types'
import { Sheet } from './Sheet'

interface Props {
  open: boolean
  today: string
  householdId: string
  /** 넣은 뒤: 넣은 건수와 가장 이른 날짜(달력을 그 날로 옮긴다) */
  onSaved: (count: number, firstDate: string) => Promise<void>
  /** 직접 넣기로 바꾸기: 일정 넣기 시트를 연다 */
  onManual: () => void
  onClose: () => void
}

type Stage = 'input' | 'loading' | 'review'

/** 일정·예약 캡처를 읽어 달력 일정으로 넣는 시트(D-039). 읽은 값은 넣기 전에 모두 고칠 수 있다 */
export function EventCaptureSheet({ open, today, householdId, onSaved, onManual, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('input')
  const [images, setImages] = useState<PreparedImage[]>([])
  const [drafts, setDrafts] = useState<EventDraft[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  // 다시 읽으면 카드를 새로 만든다(초안 key '0'이 같아도 앞 결과의 칸 상태가 남지 않게)
  const [round, setRound] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // 읽기 요청 번호. 시트를 닫았다 다시 열면 바뀌어, 늦게 끝난 이전 결과는 버린다
  const reqRef = useRef(0)

  useEffect(() => {
    if (!open) return
    reqRef.current++
    setStage('input'); setDrafts([]); setNote(null); setModel(null); setErr(''); setBusy(false); setPreparing(false)
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

  async function read() {
    if (!images.length) return
    const id = ++reqRef.current
    setStage('loading'); setErr('')
    try {
      const res = await analyzeEvents(images.map(({ media_type, data, width, height }) => ({ media_type, data, width, height })), today)
      if (id !== reqRef.current) return
      if (!res.events.length) { setErr(res.note || '캡처에서 일정을 찾지 못했어요.'); setStage('input'); return }
      // 이미 달력에 있는 일정과 견준다. 못 읽어도 넣기는 그대로 된다
      const range = eventDateRange(res.events)
      const existing = range ? await fetchEvents(householdId, range.from, range.to).catch(() => []) : []
      if (id !== reqRef.current) return
      setDrafts(toEventDrafts(res.events, existing)); setNote(res.note); setModel(modelLabel(res.model)); setRound(id); setStage('review')
    } catch (e) {
      if (id !== reqRef.current) return
      setErr(e instanceof SmartError ? e.message : friendlyError(e)); setStage('input')
    }
  }

  const patch = (key: string, p: Partial<EventDraft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)))
  const chosen = drafts.filter((d) => d.include)

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
    <Sheet open={open} title="캡처로 일정 넣기" onClose={onClose}>
      {stage === 'input' && (
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
                  <button className="pv-x" onClick={() => removeImage(i)} aria-label={`캡처 ${i + 1} 빼기`}>×</button>
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
          <div className="smart-previews">{images.map((im) => <img key={im.preview} src={im.preview} alt="고른 캡처" />)}</div>
          <p className="lead shimmer">캡처 {images.length}장에서 날짜와 시간을 읽는 중이에요</p>
          <p className="tx-meta" style={{ justifyContent: 'center' }}>보통 5~15초 걸려요.</p>
        </div>
      )}

      {stage === 'review' && (
        <>
          {note && <p className="note">{note}</p>}
          {drafts.map((d) => <EventDraftCard key={`${round}:${d.key}`} d={d} onChange={(p) => patch(d.key, p)} />)}
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={busy || !chosen.length} onClick={() => void save()}>
            {busy ? '넣는 중…' : chosen.length ? `일정 ${chosen.length}건 넣기` : '넣을 일정을 고르세요'}
          </button>
          <button className="ghost" disabled={busy} onClick={() => { setStage('input'); setErr('') }}>다시 하기</button>
          {model && <p className="tx-meta">{model}로 읽었어요</p>}
        </>
      )}

      {stage !== 'loading' && <button className="link-btn" onClick={onManual}>직접 넣기로 바꾸기</button>}
    </Sheet>
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
      <div className="field">
        <label htmlFor={id('memo')}>메모</label>
        <textarea id={id('memo')} className="input ev-memo" maxLength={200} rows={3} value={d.memo} onChange={(e) => onChange({ memo: e.target.value })} />
      </div>
    </div>
  )
}
