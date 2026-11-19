// 담은 영상의 처리 줄: 대기·처리 중·실패. 끝난 것은 레시피북에 있으니 여기서 뺀다.
// 대기 중인 일 옆에는 맥 처리기의 마지막 확인 시각을 늘 보이고, 오래 끊겼으면 "맥이 켜지면 처리돼요"를 더한다.
// 사본(드라이브·옵시디언)을 쓰지 못하고 있으면 한 줄로 알린다(처리기가 보낸 정해 둔 까닭과 확인 시각).
import type { InboxJob, WorkerStatus } from '../lib/store'
import { minutesAgo, shortSource } from '../lib/display'

const WAIT_NOTICE_MS = 2 * 60_000
/** 처리기는 5분마다 알린다. 그 두 배를 넘겨 끊겼을 때만 꺼진 것으로 본다(알림 바로 전에 깜빡이지 않게) */
export const WORKER_QUIET_MS = 12 * 60_000

/** 2분 넘게 기다렸는데 처리기가 12분 넘게 보이지 않으면 맥이 꺼져 있는 것으로 안내한다 */
export function isStuck(job: InboxJob, worker: WorkerStatus | null, now: number): boolean {
  if (job.state !== 'waiting') return false
  if (now - Date.parse(job.added_at) <= WAIT_NOTICE_MS) return false
  const seen = worker?.last_seen_at ? Date.parse(worker.last_seen_at) : null
  return seen === null || now - seen > WORKER_QUIET_MS
}

export function JobList({ jobs, worker, now, onRetry, onDismiss }: {
  jobs: InboxJob[]; worker: WorkerStatus | null; now: number; onRetry: (job: InboxJob) => void; onDismiss?: (job: InboxJob) => void
}) {
  const open = jobs.filter((j) => j.state !== 'done')
  const issue = worker?.export_issue ?? null
  if (!open.length && !issue) return null
  const seen = worker?.last_seen_at ? Date.parse(worker.last_seen_at) : null
  const checked = worker?.export_checked_at ? Date.parse(worker.export_checked_at) : null
  return (
    <section className="rcp-jobs" aria-label="담은 영상 처리">
      {open.length > 0 && (
        <>
          <h2 className="rcp-h2">처리 중</h2>
          <ul className="rcp-list">
            {open.map((j) => (
              <li key={j.id} className="rcp-job">
                <p className="rcp-job-src">{shortSource(j.source_key, j.url)}</p>
                {j.state === 'processing' && <p className="rcp-job-state">{j.stage ?? '처리 중'}</p>}
                {j.state === 'waiting' && <p className="rcp-job-state">대기 중</p>}
                {j.state === 'failed' && (
                  <>
                    <p className="rcp-job-state rcp-bad">{j.fail_reason ?? '처리하지 못했어요'}</p>
                    <div className="rcp-actions">
                      <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => onRetry(j)}>다시 하기</button>
                      {onDismiss && <button className="rcp-btn rcp-btn-quiet" type="button" aria-label={`${shortSource(j.source_key, j.url)} 목록에서 치우기`} onClick={() => onDismiss(j)}>치우기</button>}
                    </div>
                  </>
                )}
                {isStuck(j, worker, now) && <p className="rcp-job-wait">맥이 켜지면 처리돼요</p>}
                {j.state === 'waiting' && <p className="rcp-meta">맥 처리기 마지막 확인: {seen === null ? '확인 기록 없음' : minutesAgo(seen, now)}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {issue && (
        <p className="rcp-meta rcp-bad" role="status">사본: {issue}{checked !== null && Number.isFinite(checked) ? ` (${minutesAgo(checked, now)} 확인)` : ''}</p>
      )}
    </section>
  )
}
