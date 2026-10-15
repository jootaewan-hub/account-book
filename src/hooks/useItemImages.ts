import { useEffect, useState } from 'react'
import { signedUrls } from '../lib/itemImages'

/** 사진 경로 목록 → 볼 수 있는 주소 */
export function useItemImages(paths: (string | null | undefined)[]): Map<string, string> {
  const key = paths.filter(Boolean).join('|')
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const list = key ? key.split('|') : []
    if (!list.length) return
    let alive = true
    signedUrls(list).then((m) => { if (alive) setUrls(m) }).catch(() => { /* 사진 없이 보여 준다 */ })
    return () => { alive = false }
  }, [key])
  return urls
}
