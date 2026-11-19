// 인분 바꾸기: 1~8인분 여덟 칸. 기준 인분은 출처 인분, 없으면 덧붙인 인분이다.
import { SERVINGS_CHOICES } from '../../../supabase/functions/_shared/recipeUnits'

export function ServingsPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="rcp-servings" role="group" aria-label="인분 고르기">
      {SERVINGS_CHOICES.map((n) => (
        <button key={n} type="button" className="rcp-chip rcp-chip-n" aria-pressed={n === value} aria-label={`${n}인분`} onClick={() => onChange(n)}>{n}</button>
      ))}
    </div>
  )
}
