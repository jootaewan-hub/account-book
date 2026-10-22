// 품목(상품) 사진: Supabase Storage 'item-images' 비공개 버킷, 경로는 <가구 id>/<무작위>.jpg
import { sb } from './supabase'

const BUCKET = 'item-images'
const TTL = 3600 // 서명 주소 유효 시간(초)

export async function uploadItemImage(householdId: string, blob: Blob): Promise<string> {
  const path = `${householdId}/${crypto.randomUUID()}.jpg`
  const { error } = await sb().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(error.message)
  return path
}

export async function removeItemImages(paths: string[]): Promise<void> {
  if (!paths.length) return
  await sb().storage.from(BUCKET).remove(paths)
}

const cache = new Map<string, { url: string; until: number }>()
// 같은 틱에 들어온 요청(목록의 행마다 하나)을 모아 한 번에 보낸다. 진행 중인 경로는 다시 묻지 않는다
let batch: { paths: Set<string>; done: Promise<void> } | null = null
const inflight = new Map<string, Promise<void>>()

function request(paths: string[]): Promise<void> {
  if (!batch) {
    const set = new Set<string>()
    const done = new Promise<void>((resolve) => {
      setTimeout(async () => {
        batch = null
        const list = [...set]
        try {
          const { data } = await sb().storage.from(BUCKET).createSignedUrls(list, TTL)
          const now = Date.now()
          for (const d of data ?? []) {
            if (d.signedUrl && d.path) cache.set(d.path, { url: d.signedUrl, until: now + (TTL - 600) * 1000 })
          }
        } catch { /* 사진 없이 보여 준다 */ } finally {
          for (const p of list) inflight.delete(p)
          resolve()
        }
      }, 0)
    })
    batch = { paths: set, done }
  }
  for (const p of paths) { batch.paths.add(p); inflight.set(p, batch.done) }
  return batch.done
}

/** 비공개 사진을 잠시 볼 수 있는 주소로 바꾼다 (한 번에 묶어서 요청, 50분 동안 재사용) */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const unique = [...new Set(paths)]
  const missing = unique.filter((p) => !((cache.get(p)?.until ?? 0) > now))
  const waits = new Set<Promise<void>>()
  const fresh = missing.filter((p) => {
    const w = inflight.get(p)
    if (w) waits.add(w)
    return !w
  })
  if (fresh.length) waits.add(request(fresh))
  await Promise.all(waits)
  const out = new Map<string, string>()
  for (const p of unique) {
    const hit = cache.get(p)
    if (hit) out.set(p, hit.url)
  }
  return out
}
