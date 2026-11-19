// 근거 모으기의 순수한 부분: 자료 모양, 자막·받아쓰기 해석, 장면 거르기. 프로그램을 돌리지 않는다.

export type TranscriptSegment = { start: number; text: string }
export type OcrLine = { t: number; text: string }
export type Frame = { t: number; path: string }

export type Evidence = {
  meta: {
    id: string
    title: string
    channel: string
    uploadDate: string | null
    duration: number
    description: string
    chapters: { start: number; title: string }[]
  }
  transcript: { kind: 'caption_manual' | 'caption_auto' | 'asr'; segments: TranscriptSegment[] } | null
  ocr: OcrLine[]
  frames: Frame[]
  /** 고르기 전 장면 수(frames는 그중 고른 것). 없으면 frames 수와 같다고 본다 */
  framesTotal?: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** yt-dlp json3 자막: events[].tStartMs, segs[].utf8. 빈 조각·줄바꿈만 있는 조각은 버린다. */
export function parseJson3(json: unknown): TranscriptSegment[] {
  if (!isObj(json) || !Array.isArray(json.events)) return []
  const out: TranscriptSegment[] = []
  for (const e of json.events) {
    if (!isObj(e) || !Array.isArray(e.segs)) continue
    const text = clean(e.segs.map((s) => (isObj(s) && typeof s.utf8 === 'string' ? s.utf8 : '')).join(''))
    if (!text) continue
    const ms = typeof e.tStartMs === 'number' && Number.isFinite(e.tStartMs) ? e.tStartMs : 0
    out.push({ start: ms / 1000, text })
  }
  return out
}

/** whisper.cpp -oj 결과: transcription[].offsets.from(밀리초), text */
export function parseWhisperJson(json: unknown): TranscriptSegment[] {
  if (!isObj(json) || !Array.isArray(json.transcription)) return []
  const out: TranscriptSegment[] = []
  for (const s of json.transcription) {
    if (!isObj(s) || typeof s.text !== 'string') continue
    const text = clean(s.text)
    if (!text) continue
    const from = isObj(s.offsets) && typeof s.offsets.from === 'number' ? s.offsets.from : 0
    out.push({ start: from / 1000, text })
  }
  return out
}

/**
 * 16×16 RGB 작은 그림(768바이트)끼리 견줘, 마지막으로 남긴 장과 평균 차이가 문턱보다 작은 장을 버린다.
 * 남긴 장의 번호(thumbs 안 자리)를 돌려준다. 첫 장은 늘 남긴다.
 */
export function dedupe(thumbs: { t: number; pixels: Uint8Array }[], threshold = 8): number[] {
  const kept: number[] = []
  let last: Uint8Array | null = null
  thumbs.forEach((th, i) => {
    if (last) {
      const n = Math.min(last.length, th.pixels.length)
      let sum = 0
      for (let k = 0; k < n; k++) sum += Math.abs(last[k]! - th.pixels[k]!)
      if (n > 0 && sum / n < threshold) return
    }
    kept.push(i)
    last = th.pixels
  })
  return kept
}

/** 숫자+단위로 보이는 글(분량·시간). 장면 고르기와 화면 글자 고르기가 먼저 볼 것을 정한다 */
export const QTY = /\d+(?:[./]\d+)?\s*(?:kg|g|ml|l|cc|T|t|큰술|작은술|스푼|티스푼|컵|개|알|쪽|줄기|봉지|캔|모|마리|장|꼬집|대|인분|분|초)(?![A-Za-z])/i

/** 목록에서 k개를 고르게(앞뒤 끝에 몰리지 않게) 고른다. 순서는 그대로 */
export function evenly<T>(list: readonly T[], k: number): T[] {
  if (k >= list.length) return [...list]
  if (k <= 0) return []
  return Array.from({ length: k }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / k)]!)
}

/**
 * 숫자+단위 글자와 재료 이름이 함께 보이는 장, 그다음 둘 중 하나가 보이는 장, 남는 자리는 다른 장으로 채운다.
 * 묶음마다 영상 전체에 고르게 고른다(앞부분에 몰리지 않게). 시각 순으로 돌려준다.
 */
export function selectFrames(frames: Frame[], ocr: OcrLine[], names: string[], max = 24): Frame[] {
  if (frames.length <= max && ocr.length === 0) return [...frames]
  const textAt = new Map<number, string>()
  for (const l of ocr) textAt.set(l.t, `${textAt.get(l.t) ?? ''} ${l.text}`)
  const usable = names.filter((n) => n.length >= 2)
  const scored = frames.map((f, idx) => {
    const text = textAt.get(f.t) ?? ''
    const score = (QTY.test(text) ? 1 : 0) + (usable.some((n) => text.includes(n)) ? 1 : 0)
    return { f, idx, score }
  })
  const chosen: typeof scored = []
  for (const tier of [2, 1, 0]) {
    const room = max - chosen.length
    if (room <= 0) break
    chosen.push(...evenly(scored.filter((s) => s.score === tier), room))
  }
  return chosen.sort((a, b) => a.idx - b.idx).map((s) => s.f)
}

const SECTION_START = /^[\s[(【<\-•·]*(?:재료|준비물|ingredients?)/i
const SECTION_END = /^[\s[(【<\-•·]*(?:만드는|조리|레시피|방법|순서|how)/i
const STOP = new Set(['재료', '준비물', '양념', '소스', '약간', '조금', '큰술', '작은술', '스푼', '티스푼', '한줌', '적당량', '취향껏', '기호에'])

/** 설명란의 재료 칸에서 한글 재료 이름을 뽑는다(받아쓰기 첫 말과 장면 고르기에 쓴다). 없으면 빈 목록. */
export function ingredientNames(description: string): string[] {
  const out: string[] = []
  const take = (s: string) => {
    for (const m of s.match(/[가-힣]{2,8}/g) ?? []) if (!STOP.has(m) && !out.includes(m)) out.push(m)
  }
  let inSection = false
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim()
    if (SECTION_START.test(line)) {
      inSection = true
      take(line.split(/[:：]/).slice(1).join(' '))
      continue
    }
    if (!inSection) continue
    if (!line) {
      if (out.length > 0) break
      continue
    }
    if (SECTION_END.test(line)) break
    take(line)
    if (out.length >= 30) break
  }
  return out.slice(0, 30)
}
