// 품목(상품) 사진: Supabase Storage 'item-images' 비공개 버킷, 경로는 <가구 id>/<무작위>.jpg
import { makeSigner } from './storageSign'
import { sb } from './supabase'

const BUCKET = 'item-images'

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

/** 비공개 사진을 잠시 볼 수 있는 주소로 바꾼다 (한 번에 묶어서 요청, 50분 동안 재사용) */
export const signedUrls = makeSigner(BUCKET)
