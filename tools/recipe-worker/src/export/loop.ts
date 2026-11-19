// 사본 고리: 서버가 알려 주는 보관 대상(최대 10건)을 드라이브·옵시디언에 쓰고 결과를 알린다.
import type { WorkerApi } from '../api.ts'
import { DriveAuthError, type Drive } from './drive.ts'
import { trashObsidian, writeObsidian } from './obsidian.ts'

/**
 * 한 번 돈다. 알린(exported) 건수를 돌려준다.
 * 한 건이 실패하면 그 건은 알리지 않고(다음 번에 다시) 다음 건으로 간다.
 * 구글 연결 오류(DriveAuthError)가 나면 이번 번의 드라이브 일은 멈추고 옵시디언만 계속한다.
 * 이때 그 건들은 알리지 않는다: 알리면 드라이브 칸이 지워지거나 보관된 것으로 보이기 때문이다.
 */
export async function exportOnce(
  api: Pick<WorkerApi, 'exports' | 'exported'>,
  drive: Drive | null,
  obsidianDir: string | null,
  log: (msg: string) => void = (m) => console.error(m),
): Promise<number> {
  if (!drive && !obsidianDir) return 0
  const items = await api.exports()
  let reported = 0
  let driveDown = false
  for (const item of items) {
    try {
      const prev = item.prev
      if (item.trash) {
        if (obsidianDir && prev?.obsidian_path) await trashObsidian(obsidianDir, prev.obsidian_path)
        if (drive) {
          if (driveDown) continue
          if (prev?.drive_doc_id) await drive.trash(prev.drive_doc_id)
          await drive.removeListRow(item.recipe_id)
        }
        await api.exported({ recipe_id: item.recipe_id, drive_doc_id: null, drive_path: null, obsidian_path: null, snapshot_updated_at: null })
        reported++
        continue
      }
      const r = item.recipe
      if (!r) continue
      let obsidianPath = prev?.obsidian_path ?? null
      if (obsidianDir) obsidianPath = await writeObsidian(obsidianDir, r, prev?.obsidian_path ?? null)
      let docId = prev?.drive_doc_id ?? null
      let docPath = prev?.drive_path ?? null
      if (drive) {
        if (driveDown) continue
        const doc = await drive.upsertDoc(r, prev?.drive_doc_id ? { id: prev.drive_doc_id, path: prev.drive_path } : null)
        docId = doc.id
        docPath = doc.path
        await drive.upsertListRow(r, doc.id)
      }
      await api.exported({ recipe_id: item.recipe_id, drive_doc_id: docId, drive_path: docPath, obsidian_path: obsidianPath, snapshot_updated_at: r.updated_at })
      reported++
    } catch (e) {
      if (e instanceof DriveAuthError) {
        driveDown = true
        log(e.message)
      } else {
        log('사본 하나를 보관하지 못했어요. 다음에 다시 해요')
      }
    }
  }
  return reported
}
