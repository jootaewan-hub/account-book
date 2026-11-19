// 레시피 화면에서 쓰는 순수 글·주소 함수.
import type { Origin } from '../../../supabase/functions/_shared/recipeContract'
import { normalizeRecipeUrl } from '../../../supabase/functions/_shared/recipeSource'

/** 초를 4:02, 1:02:05 꼴로 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 값이 어디서 왔는지 한 줄로: "설명란", "말 4:02", "화면 0:14", "작성자 자막 1:10", "직접 고침", "덧붙임" */
export function originLabel(origin: Origin, at: number | null): string {
  const t = at === null ? '' : ` ${clock(at)}`
  switch (origin) {
    case 'description': return '설명란'
    case 'caption_manual': return `작성자 자막${t}`
    case 'caption_auto': return `자동 자막${t}`
    case 'asr': return `말${t}`
    case 'screen': return `화면${t}`
    case 'user': return '직접 고침'
    case 'editor': return '덧붙임'
  }
}

/** 그 영상의 seconds초 지점을 여는 유튜브 주소. 유튜브 주소가 아니면 그대로 */
export function videoAt(url: string, seconds: number): string {
  const n = normalizeRecipeUrl(url)
  if (!n) return url
  const id = n.key.slice('youtube:'.length)
  return `https://www.youtube.com/watch?v=${id}&t=${Math.max(0, Math.floor(seconds))}s`
}

/** "12분 전", 한 시간이 넘으면 "3시간 전", 하루가 넘으면 "2일 전" */
export function minutesAgo(fromMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - fromMs) / 60_000))
  if (min < 60) return `${min}분 전`
  if (min < 24 * 60) return `${Math.floor(min / 60)}시간 전`
  return `${Math.floor(min / (24 * 60))}일 전`
}

/** 줄에 보이는 짧은 영상 주소 */
export function shortSource(sourceKey: string, url: string): string {
  return sourceKey.startsWith('youtube:') ? `youtu.be/${sourceKey.slice(8)}` : url.replace(/^https?:\/\/(www\.)?/, '')
}
