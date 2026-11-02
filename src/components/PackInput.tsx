import { useState } from 'react'
import { packText, parsePackText } from '../lib/units'

/**
 * 영수증 상품 줄의 용량 칸(D-045). 영수증에서 못 읽은 용량을 적거나 잘못 읽은 것을 고친다('900ml', '1.5kg', '30롤').
 * 치는 동안 글자는 그대로 두고, 읽을 수 있을 때만 값을 올린다. 비우면 용량 없음
 */
export function PackInput({ name, size, unit, onChange }: {
  name: string
  size: number | null
  unit: string | null
  onChange: (p: { pack_size: number | null; pack_unit: string | null }) => void
}) {
  const [text, setText] = useState(packText(size, unit))
  const parsed = text.trim() ? parsePackText(text) : null
  const bad = text.trim() !== '' && !parsed
  return (
    <span className="pack-input">
      <input className={`input${bad ? ' bad' : ''}`} value={text} maxLength={16} placeholder="용량 예: 900ml" aria-label={`${name} 용량`}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          const t = e.target.value
          setText(t)
          if (!t.trim()) onChange({ pack_size: null, pack_unit: null })
          else {
            const p = parsePackText(t)
            if (p) onChange(p)
          }
        }} />
      {bad && <span className="pack-hint">숫자와 단위로 적어 주세요(예: 900ml, 1.5kg, 30롤)</span>}
    </span>
  )
}
