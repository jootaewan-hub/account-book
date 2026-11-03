import { useEffect, useState } from 'react'
import { signedUrls } from '../lib/itemImages'
import { signedReceiptUrls } from '../lib/receiptImages'
import type { Signer } from '../lib/storageSign'

/** 사진 경로 목록 → 볼 수 있는 주소(버킷의 서명 요청기로) */
function useSignedUrls(sign: Signer, paths: (string | null | undefined)[]): Map<string, string> {
  const key = paths.filter(Boolean).join('|')
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const list = key ? key.split('|') : []
    if (!list.length) return
    let alive = true
    sign(list).then((m) => { if (alive) setUrls(m) }).catch(() => { /* 사진 없이 보여 준다 */ })
    return () => { alive = false }
  }, [key, sign])
  return urls
}

/** 품목 사진 경로 목록 → 볼 수 있는 주소 */
export function useItemImages(paths: (string | null | undefined)[]): Map<string, string> {
  return useSignedUrls(signedUrls, paths)
}

/** 영수증 사진 경로 목록 → 볼 수 있는 주소(D-053) */
export function useReceiptImages(paths: (string | null | undefined)[]): Map<string, string> {
  return useSignedUrls(signedReceiptUrls, paths)
}
