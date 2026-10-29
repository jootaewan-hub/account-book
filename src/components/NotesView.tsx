import { useMemo, useState } from 'react'
import type { Lookup } from '../lib/lookup'
import { matchNotes, noteByline, type Note } from '../lib/notes'
import { Plus } from './Icons'

/** 함께 기억할 것 화면(D-038). 아래 탭이 아니라 달력 화면 묶음·넓은 화면 왼쪽 메뉴에서 연다 */
export function NotesView({ rows, error, lookup, onRetry, onNew, onOpen, onTogglePin }: {
  rows: Note[] | null; error: string; lookup: Lookup
  onRetry: () => void; onNew: () => void; onOpen: (note: Note) => void; onTogglePin: (note: Note) => Promise<void>
}) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const shown = useMemo(() => (rows ? matchNotes(rows, q) : []), [rows, q])

  async function pin(n: Note) {
    if (busy) return
    setBusy(n.id)
    try { await onTogglePin(n) } finally { setBusy(null) }
  }

  return (
    <section className="view remember-view" aria-label="함께 기억할 것">
      <div className="remember-intro">
        <p className="lead">둘이 함께 보고 고치는 메모예요. 날짜가 있는 일은 달력의 일정·기념일로 넣으면 다가올 때 알려 줘요.</p>
        <button className="primary remember-new" onClick={onNew}><Plus />새로 적기</button>
      </div>
      {rows !== null && rows.length > 0 && (
        <input type="search" className="input" aria-label="기억할 것 찾기" placeholder="제목·내용으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {error && (
        <div className="card error-card" role="alert">
          <p className="lead">{rows === null ? '기억할 것을 불러오지 못했어요.' : '새 내용을 불러오지 못했어요. 보이는 것은 앞서 불러온 내용이에요.'} {error}</p>
          <div className="error-actions"><button className="ghost" onClick={onRetry}>다시 불러오기</button></div>
        </div>
      )}
      {rows === null && !error && <p className="empty" role="status">불러오는 중</p>}
      {rows !== null && rows.length === 0 && (
        <p className="empty">아직 적어 둔 것이 없어요. 관리사무소 번호, 정수기 필터 바꾸는 때, 양가 선물 취향처럼 둘이 기억할 것을 적어 두세요.</p>
      )}
      {rows !== null && rows.length > 0 && shown.length === 0 && <p className="empty">‘{q.trim()}’ 들어간 메모가 없어요.</p>}
      {shown.length > 0 && (
        <ul className="remember-list">
          {shown.map((n) => (
            <li key={n.id} className="card remember-item">
              <button className="remember-open" onClick={() => onOpen(n)}>
                <span className="remember-title">{n.pinned && <span className="tag">고정</span>}{n.title}</span>
                {n.body && <span className="remember-body">{n.body}</span>}
              </button>
              <div className="remember-foot">
                <span className="remember-by">{noteByline(n, (id) => lookup.personLabel(id))}</span>
                <button className="ghost remember-pin-btn" aria-pressed={n.pinned} disabled={busy !== null} onClick={() => void pin(n)}>
                  {busy === n.id ? '저장 중' : n.pinned ? '고정 풀기' : '고정'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
