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

/** 비공개 사진을 잠시 볼 수 있는 주소로 바꾼다 (한 번에 묶어서 요청, 50분 동안 재사용) */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const missing = [...new Set(paths)].filter((p) => !((cache.get(p)?.until ?? 0) > now))
  if (missing.length) {
    const { data } = await sb().storage.from(BUCKET).createSignedUrls(missing, TTL)
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) cache.set(d.path, { url: d.signedUrl, until: now + (TTL - 600) * 1000 })
    }
  }
  const out = new Map<string, string>()
  for (const p of paths) {
    const hit = cache.get(p)
    if (hit) out.set(p, hit.url)
  }
  return out
}
