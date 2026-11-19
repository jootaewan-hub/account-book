// 담은 영상의 처리 줄: 대기·처리 중·실패. 끝난 것은 레시피북에 있으니 여기서 뺀다.
import type { InboxJob, WorkerStatus } from '../lib/store'
import { minutesAgo, shortSource } from '../lib/display'

const WAIT_NOTICE_MS = 2 * 60_000
const WORKER_QUIET_MS = 5 * 60_000

/** 2분 넘게 기다렸는데 처리기가 5분 넘게 보이지 않으면 맥이 꺼져 있는 것으로 안내한다 */
export function isStuck(job: InboxJob, worker: WorkerStatus | null, now: number): boolean {
  if (job.state !== 'waiting') return false
  if (now - Date.parse(job.added_at) <= WAIT_NOTICE_MS) return false
  const seen = worker?.last_seen_at ? Date.parse(worker.last_seen_at) : null
  return seen === null || now - seen > WORKER_QUIET_MS
}

export function JobList({ jobs, worker, now, onRetry }: {
  jobs: InboxJob[]; worker: WorkerStatus | null; now: number; onRetry: (job: InboxJob) => void
}) {
  const open = jobs.filter((j) => j.state !== 'done')
  if (!open.length) return null
  const seen = worker?.last_seen_at ? Date.parse(worker.last_seen_at) : null
  return (
    <section className="rcp-jobs" aria-label="담은 영상 처리">
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
                <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => onRetry(j)}>다시 하기</button>
              </>
            )}
            {isStuck(j, worker, now) && (
              <>
                <p className="rcp-job-wait">맥이 켜지면 처리돼요</p>
                <p className="rcp-meta">맥 처리기 마지막 확인: {seen === null ? '확인 기록 없음' : minutesAgo(seen, now)}</p>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
