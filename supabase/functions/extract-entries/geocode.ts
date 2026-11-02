// 일정 장소의 좌표 찾기(D-041). 카카오 로컬 API(공식)로 주소 → 좌표, 안 되면 장소 이름 검색 결과가 같은 시·구일 때만 쓴다.
// 키(KAKAO_REST_API_KEY)가 없거나 실패하면 좌표 없이 둔다(앱은 네이버 지도 검색을 연다). 모델이 만든 좌표는 쓰지 않는다.
// Deno(Edge Function)와 Node(vitest)에서 함께 쓰므로 fetch를 인자로 받는다.

export interface Coords {
  lat: number
  lng: number
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>

const KAKAO = 'https://dapi.kakao.com/v2/local/search'
const TIMEOUT_MS = 4000

/** '서울 중구 을지로 30 본관 1층' → '서울 중구 을지로 30'. 도로명(…로·…길) + 건물번호 뒤의 동·층·호는 뗀다 */
export function trimAddress(address: string): string {
  const s = address.replace(/\s+/g, ' ').trim()
  const m = /^(.*?(?:로|길)\s?\d+(?:-\d+)?)(?=\s|,|\(|$)/.exec(s)
  return m ? m[1] : s
}

/** 주소의 앞 두 덩이(시·도와 시·군·구)가 같은지. 이름 검색 결과가 다른 동네의 같은 이름 가게인지 거른다 */
export function sameArea(a: string, b: string): boolean {
  const head = (s: string) => s.replace(/특별시|광역시|특별자치시|특별자치도/g, '').split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
  const x = head(a)
  return x.split(' ').length === 2 && x === head(b)
}

/** 한국 안쪽(대략)의 좌표만 */
export function inKorea(c: Coords): boolean {
  return Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.lat >= 33 && c.lat <= 39 && c.lng >= 124 && c.lng <= 132
}

type Doc = { x?: string; y?: string; address_name?: string; road_address_name?: string }

async function search(kind: 'address' | 'keyword', query: string, key: string, fetchFn: Fetch): Promise<Doc[]> {
  const res = await fetchFn(`${KAKAO}/${kind}.json?query=${encodeURIComponent(query)}&size=5`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return []
  const body = (await res.json()) as { documents?: Doc[] }
  return Array.isArray(body.documents) ? body.documents : []
}

const coordsOf = (d: Doc | undefined): Coords | null => {
  if (!d) return null
  const c = { lng: Number(d.x), lat: Number(d.y) }
  return inKorea(c) ? c : null
}

/**
 * 장소 좌표. 주소가 있어야 찾는다(이름만으로는 다른 지점이 잡힐 수 있다).
 * ① 주소 그대로 ② 동·층을 뗀 주소 ③ '장소 이름 + 시·구'로 이름 검색, 결과 주소가 같은 시·구일 때만.
 */
export async function geocodePlace(place: string | null, address: string | null, key: string | undefined, fetchFn: Fetch): Promise<Coords | null> {
  if (!key || !address?.trim()) return null
  try {
    const full = address.trim()
    const short = trimAddress(full)
    for (const q of short === full ? [full] : [full, short]) {
      const hit = coordsOf((await search('address', q, key, fetchFn))[0])
      if (hit) return hit
    }
    if (place?.trim()) {
      const area = full.split(/\s+/).slice(0, 2).join(' ')
      const docs = await search('keyword', `${area} ${place.trim()}`, key, fetchFn)
      const match = docs.find((d) => sameArea(full, d.road_address_name || d.address_name || ''))
      return coordsOf(match)
    }
  } catch (e) {
    console.error('geocode_failed', e instanceof Error ? e.name : 'error')
  }
  return null
}
