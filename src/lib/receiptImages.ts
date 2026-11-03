// 영수증 사진(D-053): Supabase Storage 'receipt-images' 비공개 버킷. 영수증 확인 화면에서 저장할 때 분석에 쓴 축소 JPEG를
// <가구 id>/<내역 id>/<n>.jpg로 올리고, transactions.receipt_path에는 폴더 <가구 id>/<내역 id>를 적는다.
// 상품별로 나눠 저장한 내역(save_batch)은 첫 내역의 폴더를 함께 가리킨다.
import { makeSigner } from './storageSign'
import { sb } from './supabase'

export const RECEIPT_BUCKET = 'receipt-images'
const LIST_LIMIT = 100

/** 한 영수증의 사진 폴더(receipt_path에 적는 값) */
export const receiptFolder = (householdId: string, txId: string) => `${householdId}/${txId}`

/** 폴더 안 파일 이름(1.jpg, 2.jpg, 10.jpg…)을 번호 순으로 정리해 전체 경로로. 번호.jpg가 아닌 파일은 뺀다 */
export function receiptImagePaths(folder: string, names: string[]): string[] {
  return names.filter((n) => /^\d+\.jpg$/.test(n)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map((n) => `${folder}/${n}`)
}

/** 분석 결과 한 건이 읽은 사진 번호(1부터, 오름차순). 번호가 없으면(옛 서버 응답) 사진이 한 장일 때만 그 한 장 */
export function receiptImageIndexes(entry: { images?: number[] | null }, imageCount: number): number[] {
  const list = (entry.images ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= imageCount)
  if (list.length) return [...new Set(list)].sort((a, b) => a - b)
  return imageCount === 1 ? [1] : []
}

/**
 * 사진을 폴더에 1.jpg, 2.jpg… 로 올린다. 하나라도 실패하면 올린 것을 지우고 false(내역은 그대로 두고 receipt_path만 비워 둔다).
 * 올릴 사진이 없으면 false
 */
export async function uploadReceiptImages(folder: string, blobs: Blob[]): Promise<boolean> {
  const done: string[] = []
  for (const [i, blob] of blobs.entries()) {
    const path = `${folder}/${i + 1}.jpg`
    const { error } = await sb().storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true })
    if (error) {
      if (done.length) await sb().storage.from(RECEIPT_BUCKET).remove(done).catch(() => undefined)
      return false
    }
    done.push(path)
  }
  return done.length > 0
}

/** 내역들의 receipt_path를 적는다(칸 수정 권한은 init 마이그레이션에 있다) */
export async function setReceiptPath(txIds: string[], folder: string | null): Promise<void> {
  if (!txIds.length) return
  const { error } = await sb().from('transactions').update({ receipt_path: folder }).in('id', txIds)
  if (error) throw new Error(error.message)
}

/** 폴더의 사진 경로(번호 순). 폴더가 없으면 빈 목록 */
export async function listReceiptImages(folder: string): Promise<string[]> {
  const { data, error } = await sb().storage.from(RECEIPT_BUCKET).list(folder, { limit: LIST_LIMIT })
  if (error) throw new Error(error.message)
  return receiptImagePaths(folder, (data ?? []).map((f) => f.name))
}

/** 저장된 사진을 내려받는다(다시 읽기). 하나라도 실패하면 던진다 */
export async function downloadReceiptImages(paths: string[]): Promise<Blob[]> {
  return Promise.all(paths.map(async (p) => {
    const { data, error } = await sb().storage.from(RECEIPT_BUCKET).download(p)
    if (error || !data) throw new Error(error?.message ?? 'download_failed')
    return data
  }))
}

/** 영수증 사진을 지우고, 같은 폴더를 가리키는 내역 모두의 receipt_path를 비운다(나눠 저장한 내역이 함께 쓴다) */
export async function removeReceiptImages(folder: string): Promise<void> {
  const paths = await listReceiptImages(folder)
  if (paths.length) {
    const { error } = await sb().storage.from(RECEIPT_BUCKET).remove(paths)
    if (error) throw new Error(error.message)
  }
  const { error } = await sb().from('transactions').update({ receipt_path: null }).eq('receipt_path', folder)
  if (error) throw new Error(error.message)
}

/** 내역을 지운 뒤: 그 폴더를 아직 가리키는 내역이 하나도 없을 때만 사진을 지운다. 실패해도 조용히 넘어간다(사진이 남을 뿐) */
export async function removeUnusedReceiptImages(folders: (string | null | undefined)[]): Promise<void> {
  for (const folder of new Set(folders.filter((f): f is string => Boolean(f)))) {
    try {
      const { data, error } = await sb().from('transactions').select('id').eq('receipt_path', folder).limit(1)
      if (error || (data?.length ?? 0) > 0) continue
      const paths = await listReceiptImages(folder)
      if (paths.length) await sb().storage.from(RECEIPT_BUCKET).remove(paths)
    } catch { /* 사진은 남을 수 있다 */ }
  }
}

/** 비공개 영수증 사진을 잠시 볼 수 있는 주소로(한 번에 묶어서 요청, 50분 동안 재사용) */
export const signedReceiptUrls = makeSigner(RECEIPT_BUCKET)
