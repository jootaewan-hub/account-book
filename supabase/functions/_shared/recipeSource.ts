// 영상 주소를 같은 열쇠로 맞춘다. 순수 함수라 Vite·Deno·Node에서 같이 쓴다.

const ID = /^[A-Za-z0-9_-]{11}$/
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])

export type NormalizedRecipeUrl = { kind: 'youtube' | 'youtube_shorts'; key: string; url: string }

function watch(id: string): NormalizedRecipeUrl | null {
  if (!ID.test(id)) return null
  return { kind: 'youtube', key: `youtube:${id}`, url: `https://www.youtube.com/watch?v=${id}` }
}

export function normalizeRecipeUrl(input: string): NormalizedRecipeUrl | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be') return parts.length >= 1 ? watch(parts[0]) : null
  if (!HOSTS.has(host)) return null

  if (parts[0] === 'watch') return watch(u.searchParams.get('v') ?? '')
  if (parts[0] === 'live' || parts[0] === 'embed') return parts[1] ? watch(parts[1]) : null
  if (parts[0] === 'shorts') {
    const id = parts[1] ?? ''
    if (!ID.test(id)) return null
    return { kind: 'youtube_shorts', key: `youtube:${id}`, url: `https://www.youtube.com/shorts/${id}` }
  }
  return null
}
