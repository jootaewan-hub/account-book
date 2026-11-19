// 사본 고리: 서버가 알려 주는 보관 대상(최대 10건)을 드라이브·옵시디언에 쓰고 결과를 알린다.
import type { WorkerApi } from '../api.ts'
import { DriveAuthError, type Drive } from './drive.ts'
import { trashObsidian, writeObsidian } from './obsidian.ts'

const FIRST_MS = 5 * 60_000
const MAX_MS = 6 * 60 * 60_000

const BLOCK_MS = 30 * 60_000
/** 서버가 받는 skip 한도와 같다 */
const SKIP_MAX = 1000

/**
 * 건별 실패 뒤 물러서기: 5분, 두 배씩, 최대 6시간. 성공하면 지운다. 메모리에만 둔다.
 * block은 따로다: 설정된 보관 자리(구글)를 쓸 수 없어 못 알린 건을 30분 고정으로 비켜 두어 다른 건이 앞으로 나오게 한다(두 배로 늘지 않는다).
 */
export function createBackoff(now: () => number = Date.now) {
  const m = new Map<string, { fails: number; until: number }>()
  const blocked = new Map<string, number>()
  const seq = new Map<string, number>() // 가장 최근에 걸린 순서(넘치면 오래된 것부터 버린다)
  let n = 0
  return {
    block(id: string) { blocked.set(id, now() + BLOCK_MS); seq.set(id, ++n) },
    fail(id: string) {
      const fails = (m.get(id)?.fails ?? 0) + 1
      m.set(id, { fails, until: now() + Math.min(FIRST_MS * 2 ** (fails - 1), MAX_MS) })
      seq.set(id, ++n)
    },
    ok(id: string) { m.delete(id); blocked.delete(id); seq.delete(id) },
    skipped(): string[] {
      const t = now()
      const ids = new Set([...m].filter(([, v]) => v.until > t).map(([id]) => id))
      for (const [id, until] of blocked) if (until > t) ids.add(id)
      return [...ids].sort((a, b) => (seq.get(a) ?? 0) - (seq.get(b) ?? 0)).slice(-SKIP_MAX)
    },
  }
}
export type Backoff = ReturnType<typeof createBackoff>

export type ExportOptions = {
  /** 드라이브가 설정돼 있는가(토큰 파일이 아직 없어 drive가 null이어도 true). 기본: drive가 있는가 */
  driveConfigured?: boolean
  backoff?: Backoff
}

/**
 * 한 번 돈다. 알린(exported) 건수를 돌려준다.
 * 설정된 보관 자리가 모두 성공한 건만 알린다. 쓸 수 없는 자리(토큰 파일 없음·DriveAuthError)가 있으면 알리지 않고 다음에 다시 한다
 * (알리면 나중에 구글을 연결해도 채우지 못하고, 지움이면 고아가 남는다).
 * 한 건이 실패하면 그 건만 알리지 않고 다음 건으로 가며, 그 건은 물러서기 동안 서버에 skip으로 알려 새 건이 막히지 않게 한다.
 */
export async function exportOnce(
  api: Pick<WorkerApi, 'exports' | 'exported'>,
  drive: Drive | null,
  obsidianDir: string | null,
  log: (msg: string) => void = (m) => console.error(m),
  opts: ExportOptions = {},
): Promise<number> {
  const driveConfigured = opts.driveConfigured ?? drive !== null
  if (!driveConfigured && !obsidianDir) return 0
  const backoff = opts.backoff
  const need: ('drive' | 'obsidian')[] = []
  if (driveConfigured) need.push('drive')
  if (obsidianDir) need.push('obsidian')
  const items = await api.exports({ skip: backoff?.skipped() ?? [], need })
  let reported = 0
  let driveDown = false
  for (const item of items) {
    const id = item.recipe_id
    const prev = item.prev
    let blocked = false // 연결 문제로 못 한 일(건 탓이 아니라 실패 물러서기 대신 30분 비켜 두기)
    try {
      const driveUp = !!drive && !driveDown
      if (item.trash) {
        let handled = true
        if (prev?.obsidian_path) {
          if (obsidianDir) await trashObsidian(obsidianDir, prev.obsidian_path)
          else handled = false
        }
        if (driveUp) {
          if (prev?.drive_doc_id) await drive.trash(prev.drive_doc_id)
          await drive.removeListRow(id)
        } else if (prev?.drive_doc_id) {
          handled = false
          if (driveConfigured) blocked = true
        }
        if (!handled) {
          if (blocked) backoff?.block(id)
          else backoff?.fail(id)
          continue
        }
        await api.exported({ recipe_id: id, drive_doc_id: null, drive_path: null, obsidian_path: null, snapshot_updated_at: null })
        backoff?.ok(id)
        reported++
        continue
      }
      const r = item.recipe
      if (!r) continue
      let obsidianPath = prev?.obsidian_path ?? null
      if (obsidianDir) obsidianPath = await writeObsidian(obsidianDir, r, prev?.obsidian_path ?? null)
      let docId = prev?.drive_doc_id ?? null
      let docPath = prev?.drive_path ?? null
      if (driveConfigured) {
        if (!driveUp) { backoff?.block(id); continue } // 구글을 쓸 수 없다: 알리지 않고 다음에 다시
        const doc = await drive.upsertDoc(r, prev?.drive_doc_id ? { id: prev.drive_doc_id, path: prev.drive_path } : null)
        docId = doc.id
        docPath = doc.path
        await drive.upsertListRow(r, doc.id)
      }
      await api.exported({ recipe_id: id, drive_doc_id: docId, drive_path: docPath, obsidian_path: obsidianPath, snapshot_updated_at: r.updated_at })
      backoff?.ok(id)
      reported++
    } catch (e) {
      if (e instanceof DriveAuthError) {
        driveDown = true
        blocked = true
        log(e.message)
      } else {
        log('사본 하나를 보관하지 못했어요. 다음에 다시 해요')
      }
      if (blocked) backoff?.block(id)
      else backoff?.fail(id)
    }
  }
  return reported
}
