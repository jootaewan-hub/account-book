import { SCOPE_LABEL } from '../lib/lookup'
import type { Scope } from '../lib/types'

/** 일정의 '누구 일정'(D-044) 고르기: 함께(우리 둘)·남편·아내 */
export const EVENT_SCOPES: Scope[] = ['shared', 'husband', 'wife']
export const eventScopeLabel = (s: Scope) => (s === 'shared' ? '함께' : SCOPE_LABEL[s])
/** 남편·아내 일정의 태그 색(내역의 누구 태그와 같다). 함께는 태그 없음 */
export const WHO_TAG: Record<Scope, string> = { shared: '', husband: 'who-husband', wife: 'who-wife', child: 'who-child' }

export function EventScopeSeg({ value, onChange, label = '누구 일정' }: { value: Scope; onChange: (s: Scope) => void; label?: string }) {
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {EVENT_SCOPES.map((s) => (
          <button type="button" key={s} aria-pressed={value === s} onClick={() => onChange(s)}>{eventScopeLabel(s)}</button>
        ))}
      </div>
    </div>
  )
}

/** 남편·아내 일정이면 작은 태그, 함께면 없음 */
export function EventScopeTag({ scope }: { scope: Scope }) {
  return scope === 'shared' ? null : <span className={`tag ${WHO_TAG[scope]}`}>{eventScopeLabel(scope)}</span>
}
