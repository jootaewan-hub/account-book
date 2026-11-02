// 일정 장소를 네이버 지도로 여는 주소(D-041).
// 좌표가 있으면 길찾기(출발지는 비워 두어 네이버가 현재 위치·직접 입력을 받는다), 없으면 장소·주소 검색.
// 길찾기 주소의 한 칸은 '경도,위도,이름,장소번호,종류'라 이름의 쉼표·빗금은 뺀다(2026-11-02 네이버 지도에서 확인).
import type { CalEvent } from './types'

export type RouteMode = 'transit' | 'car'

type Place = Pick<CalEvent, 'title' | 'place' | 'address' | 'lat' | 'lng'>

const cleanName = (s: string) => s.replace(/[,/\\?#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)

/** 이 일정에 장소 정보가 있는지(장소 이름·주소·좌표 중 하나) */
export function hasPlace(e: Place): boolean {
  return Boolean(e.place?.trim() || e.address?.trim() || (e.lat !== null && e.lng !== null))
}

/** 네이버 지도 주소. 장소 정보가 없으면 null */
export function naverMapUrl(e: Place, mode: RouteMode = 'transit'): string | null {
  const name = cleanName(e.place || e.title || '도착지') || '도착지'
  if (e.lat !== null && e.lng !== null && Number.isFinite(e.lat) && Number.isFinite(e.lng)) {
    // 경도가 먼저다(카카오 x = 경도, y = 위도)
    return `https://map.naver.com/p/directions/-/${e.lng},${e.lat},${encodeURIComponent(name)},,PLACE_POI/-/${mode}`
  }
  const query = (e.address?.trim() || e.place?.trim() || '').slice(0, 120)
  return query ? `https://map.naver.com/p/search/${encodeURIComponent(query)}` : null
}

/** 화면에 보일 장소 한 줄: 장소 이름, 없으면 주소 */
export function placeLabel(e: Place): string {
  return e.place?.trim() || e.address?.trim() || '장소'
}
