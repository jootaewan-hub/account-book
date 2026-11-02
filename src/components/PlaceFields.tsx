import { hasPlace, naverMapUrl } from '../lib/naverMap'
import type { CalEvent } from '../lib/types'
import { MapPinIcon } from './Icons'

type Place = Pick<CalEvent, 'title' | 'place' | 'address' | 'lat' | 'lng'>

/** 일정의 장소·주소 칸과 네이버 지도 길찾기 링크(D-041). 주소를 고치면 좌표를 지운다(옛 위치로 길찾기가 열리지 않게) */
export function PlaceFields({ idPrefix, value, onChange }: {
  idPrefix: string
  value: Place
  onChange: (p: Partial<Pick<CalEvent, 'place' | 'address' | 'lat' | 'lng'>>) => void
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-place`}>장소 (선택)</label>
        <input id={`${idPrefix}-place`} className="input" maxLength={60} placeholder="예: OO식당" value={value.place ?? ''}
          onChange={(e) => onChange({ place: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-address`}>주소 (선택)</label>
        <input id={`${idPrefix}-address`} className="input" maxLength={120} placeholder="예: 서울 중구 을지로 30" value={value.address ?? ''}
          onChange={(e) => onChange({ address: e.target.value, lat: null, lng: null })} />
      </div>
      <RouteLinks value={value} />
    </>
  )
}

/** 좌표가 있으면 대중교통·자동차 길찾기, 없으면 네이버 지도 검색. 새 탭(휴대폰은 네이버 지도 웹·앱)으로 연다 */
export function RouteLinks({ value }: { value: Place }) {
  if (!hasPlace(value)) return null
  const coords = value.lat !== null && value.lng !== null
  const search = naverMapUrl(value)
  return (
    <div className="route-links">
      {coords ? (
        <>
          <a className="route-link" href={naverMapUrl(value, 'transit') ?? undefined} target="_blank" rel="noopener noreferrer"><MapPinIcon />대중교통 길찾기</a>
          <a className="route-link" href={naverMapUrl(value, 'car') ?? undefined} target="_blank" rel="noopener noreferrer"><MapPinIcon />자동차 길찾기</a>
        </>
      ) : search && (
        <a className="route-link" href={search} target="_blank" rel="noopener noreferrer"><MapPinIcon />네이버 지도에서 찾기</a>
      )}
      <span className="tx-meta">{coords ? '네이버 지도로 열려요' : '위치를 몰라 네이버 지도 검색으로 열려요'}</span>
    </div>
  )
}
