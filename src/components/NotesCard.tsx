import { firstLine, HOME_PINS, type Note } from '../lib/notes'
import { Plus } from './Icons'
import { Bar, useAppear, Waiting } from './Loading'

/** 달력 화면의 함께 기억할 것 묶음(D-038): 고정한 메모 셋까지. 머리 줄을 누르면 기억할 것 화면 */
export function NotesCard({ rows, error, onOpenAll, onOpen, onNew, onRetry }: {
  rows: Note[] | null; error: string
  onOpenAll: () => void; onOpen: (note: Note) => void; onNew: () => void; onRetry: () => void
}) {
  const pins = rows?.filter((n) => n.pinned).slice(0, HOME_PINS) ?? []
  const appear = useAppear(rows === null && !error)
  return (
    <section className="card remember-card" aria-labelledby="remember-card-title">
      <div className="remember-head">
        <h2 id="remember-card-title" className="section-title">함께 기억할 것</h2>
        <button className="link-btn" onClick={onOpenAll}>{rows?.length ? `${rows.length}개 모두 보기` : '열기'}</button>
      </div>
      {error && rows === null ? (
        <div className="remember-hint" role="alert">불러오지 못했어요. <button className="link-btn" onClick={onRetry}>다시 불러오기</button></div>
      ) : rows === null ? (
        <Waiting label="기억할 것 불러오는 중" className="remember-pins">
          {[[7, 15], [9, 8]].map(([t, m]) => (
            <div key={t} className="remember-pin"><b><Bar w={t} /></b><span><Bar w={m} /></span></div>
          ))}
        </Waiting>
      ) : pins.length ? (
        <ul className={`remember-pins${appear ? ` ${appear}` : ''}`}>
          {pins.map((n) => (
            <li key={n.id}>
              <button className="remember-pin" onClick={() => onOpen(n)}>
                <b>{n.title}</b>
                {n.body && <span>{firstLine(n.body)}</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : rows.length ? (
        <p className="remember-hint">자주 볼 것은 고정하면 여기에 보여요.</p>
      ) : (
        <>
          <p className="remember-hint">관리사무소 번호, 정수기 필터 바꾸는 때처럼 둘이 기억할 것을 적어 두세요.</p>
          <button className="day-add" onClick={onNew}><Plus />적어 두기</button>
        </>
      )}
    </section>
  )
}
