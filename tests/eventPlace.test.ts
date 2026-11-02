// 일정 장소(D-041): 서버의 좌표 찾기(카카오 로컬, 키가 있을 때만)와 네이버 지도 주소
import { describe, expect, it, vi } from 'vitest'
import { geocodePlace, inKorea, sameArea, trimAddress } from '../supabase/functions/extract-entries/geocode'
import { hasPlace, naverMapUrl, placeLabel } from '../src/lib/naverMap'

type Doc = { x?: string; y?: string; address_name?: string; road_address_name?: string }
/** 카카오 로컬 흉내: 부른 주소를 모으고, 검색 종류·검색어별로 정해 둔 결과를 준다 */
function fakeKakao(answers: Record<string, Doc[]>) {
  const calls: string[] = []
  const fetchFn = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    calls.push(url)
    expect(init.headers.Authorization).toBe('KakaoAK test-key')
    const u = new URL(url)
    const kind = u.pathname.endsWith('/keyword.json') ? 'keyword' : 'address'
    return { ok: true, json: async () => ({ documents: answers[`${kind}:${u.searchParams.get('query')}`] ?? [] }) }
  })
  return { fetchFn, calls }
}

describe('좌표 찾기 (geocodePlace)', () => {
  it('키나 주소가 없으면 부르지 않는다(이름만으로는 다른 지점이 잡힐 수 있다)', async () => {
    const { fetchFn } = fakeKakao({})
    expect(await geocodePlace('라세느', '서울 중구 을지로 30', undefined, fetchFn)).toBeNull()
    expect(await geocodePlace('라세느', null, 'test-key', fetchFn)).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('주소 그대로 → 동·층을 뗀 주소 순서로 찾고, x는 경도·y는 위도다', async () => {
    const { fetchFn, calls } = fakeKakao({ 'address:서울 중구 을지로 30': [{ x: '126.9810075639', y: '37.5653458904198' }] })
    expect(await geocodePlace('더그랜드롯데 서울 라세느', '서울 중구 을지로 30 본관 1층', 'test-key', fetchFn)).toEqual({ lat: 37.5653458904198, lng: 126.9810075639 })
    expect(calls.map((c) => new URL(c).searchParams.get('query'))).toEqual(['서울 중구 을지로 30 본관 1층', '서울 중구 을지로 30'])
  })

  it('주소로 못 찾으면 "시·구 + 장소 이름"으로 찾되, 결과가 같은 시·구일 때만 쓴다', async () => {
    const other = { x: '127.1', y: '37.51', road_address_name: '서울 송파구 올림픽로 240' }
    const same = { x: '126.98', y: '37.565', road_address_name: '서울 중구 을지로 30' }
    const { fetchFn } = fakeKakao({ 'keyword:서울 중구 라세느': [other, same] })
    expect(await geocodePlace('라세느', '서울 중구 어딘가', 'test-key', fetchFn)).toEqual({ lat: 37.565, lng: 126.98 })
    const only = fakeKakao({ 'keyword:서울 중구 라세느': [other] })
    expect(await geocodePlace('라세느', '서울 중구 어딘가', 'test-key', only.fetchFn)).toBeNull()
  })

  it('실패·이상한 좌표는 좌표 없이 둔다', async () => {
    const bad = vi.fn(async () => { throw new Error('timeout') })
    expect(await geocodePlace('x', '서울 중구 을지로 30', 'test-key', bad)).toBeNull()
    const { fetchFn } = fakeKakao({ 'address:서울 중구 을지로 30': [{ x: '0', y: '0' }] })
    expect(await geocodePlace(null, '서울 중구 을지로 30', 'test-key', fetchFn)).toBeNull()
  })

  it('주소 다듬기·같은 시·구·한국 범위', () => {
    expect(trimAddress('서울 용산구 한강대로40길 14 1층 104호')).toBe('서울 용산구 한강대로40길 14')
    expect(trimAddress('경기 성남시 분당구 정자일로 80')).toBe('경기 성남시 분당구 정자일로 80')
    expect(trimAddress('서울 중구 소공동 1')).toBe('서울 중구 소공동 1')
    expect(sameArea('서울특별시 중구 을지로 30', '서울 중구 남대문로 81')).toBe(true)
    expect(sameArea('서울 중구 을지로 30', '서울 송파구 올림픽로 240')).toBe(false)
    expect(inKorea({ lat: 37.5, lng: 127 })).toBe(true)
    expect(inKorea({ lat: 127, lng: 37.5 })).toBe(false)
  })
})

describe('네이버 지도 주소 (naverMapUrl)', () => {
  const base = { title: '라세느 예약', place: '더그랜드롯데 서울 라세느', address: '서울 중구 을지로 30 본관 1층', lat: 37.5653458904198, lng: 126.9810075639 }

  it('좌표가 있으면 길찾기: 출발지는 비우고(-) 도착지는 경도,위도,이름 순서', () => {
    expect(naverMapUrl(base)).toBe(`https://map.naver.com/p/directions/-/126.9810075639,37.5653458904198,${encodeURIComponent('더그랜드롯데 서울 라세느')},,PLACE_POI/-/transit`)
    expect(naverMapUrl(base, 'car')).toMatch(/\/-\/car$/)
  })

  it('이름의 쉼표·빗금은 빼서 주소 칸이 깨지지 않게 한다', () => {
    const url = naverMapUrl({ ...base, place: 'OO식당, 2층/별관' })!
    expect(decodeURIComponent(url.split('/')[6])).toBe('126.9810075639,37.5653458904198,OO식당 2층 별관,,PLACE_POI')
  })

  it('좌표가 없으면 주소(없으면 장소 이름)로 검색, 장소 정보가 없으면 null', () => {
    expect(naverMapUrl({ ...base, lat: null, lng: null })).toBe(`https://map.naver.com/p/search/${encodeURIComponent('서울 중구 을지로 30 본관 1층')}`)
    expect(naverMapUrl({ ...base, address: null, lat: null, lng: null })).toBe(`https://map.naver.com/p/search/${encodeURIComponent('더그랜드롯데 서울 라세느')}`)
    const empty = { title: '치과', place: null, address: null, lat: null, lng: null }
    expect(naverMapUrl(empty)).toBeNull()
    expect(hasPlace(empty)).toBe(false)
    expect(placeLabel({ ...empty, address: '서울 서초구 강남대로 1' })).toBe('서울 서초구 강남대로 1')
  })
})
