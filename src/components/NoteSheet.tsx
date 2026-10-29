import { useId, useState, type FormEvent } from 'react'
import { friendlyError } from '../lib/api'
import { BODY_MAX, NoteConflict, TITLE_MAX, type Note, type NoteStore } from '../lib/notes'
import { Sheet } from './Sheet'

/** 함께 기억할 것 적기·고치기(D-038). 달력 화면 묶음과 기억할 것 화면에서 함께 쓴다 */
export function NoteSheet({ note, store, onSaved, onClose }: {
  /** null이면 새로 적기 */
  note: Note | null; store: NoteStore; onSaved: (message: string) => void; onClose: () => void
}) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const id = useId()

  async function save(e: FormEvent | null, force = false) {
    e?.preventDefault()
    if (busy) return
    setError(''); setBusy(true)
    try {
      await store.save({ title, body, pinned }, note ?? undefined, force)
      onSaved(note ? '고쳤어요' : '적어 두었어요')
    } catch (err) {
      setConflict(err instanceof NoteConflict)
      setError(err instanceof NoteConflict ? `${err.message} 적은 내용은 그대로 있어요.` : friendlyError(err))
      setBusy(false)
    }
  }

  async function remove() {
    if (!note || busy) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setBusy(true); setError('')
    try { await store.remove(note.id); onSaved('지웠어요') }
    catch (err) { setError(friendlyError(err)); setBusy(false) }
  }

  return (
    <Sheet open title={note ? '기억할 것 고치기' : '기억할 것 적기'} onClose={busy ? () => {} : onClose}>
      <form className="remember-editor" onSubmit={(e) => void save(e)}>
        <div className="field"><label htmlFor={`${id}-title`}>제목</label>
          <input id={`${id}-title`} className="input" value={title} maxLength={TITLE_MAX} required onChange={(e) => setTitle(e.target.value)} placeholder="예: 관리사무소 전화번호" /></div>
        <div className="field"><label htmlFor={`${id}-body`}>내용</label>
          <textarea id={`${id}-body`} className="input" rows={6} value={body} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)} placeholder="자세한 내용 (없으면 비워 두기)" /></div>
        <label className="check">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          맨 위에 고정하고 달력 화면에도 보이기
        </label>
        <p className="remember-note">두 사람만 볼 수 있어요. 카드·통장 비밀번호는 적지 마세요.</p>
        {error && <p className="err" role="alert">{error}</p>}
        {conflict && <button type="button" className="ghost" disabled={busy} onClick={() => void save(null, true)}>그래도 내 내용으로 저장</button>}
        <button className="primary" disabled={busy}>{busy ? '저장 중…' : '저장하기'}</button>
        {note && <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>{confirmDelete ? '한 번 더 누르면 지워요' : '지우기'}</button>}
      </form>
    </Sheet>
  )
}
