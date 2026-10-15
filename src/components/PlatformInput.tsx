import { PLATFORM_NAMES } from '../lib/platform'

const LIST_ID = 'platform-names'

/** 플랫폼 입력 칸. 추천 목록(datalist)은 앱에 한 번만 둔다 */
export function PlatformInput({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  return (
    <input id={id} className="input" list={LIST_ID} value={value} maxLength={30} autoComplete="off"
      placeholder="예: 쿠팡 (매장 결제면 비워 두기)" onChange={(e) => onChange(e.target.value)} />
  )
}

export function PlatformDatalist() {
  return <datalist id={LIST_ID}>{PLATFORM_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
}
