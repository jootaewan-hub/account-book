import { recurringIconKey, type RecurringIconKey } from '../lib/recurringIcon'
import type { RecurringKind, TxType } from '../lib/types'

// 24 격자, 선 1.75px, 둥근 끝(DESIGN.md 아이콘 규칙). 이모지는 쓰지 않는다
const PATHS: Record<Exclude<RecurringIconKey, 'subscription'>, string> = {
  tax: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  insurance: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z',
  home: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  loan: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  phone: 'M7 2.5h10a2 2 0 012 2v15a2 2 0 01-2 2H7a2 2 0 01-2-2v-15a2 2 0 012-2zM11 18h2',
  education: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13',
  utility: 'M13 2L5 14h6l-1 8 8-12h-6z',
  installment: 'M3 6h18v13H3zM3 10h18M7 15h4',
  income: 'M3 7h18v12H3zM3 11h18M16 15h2',
  car: 'M5 13l2-5h10l2 5M3 13h18v6H3zM7.5 19v1.5M16.5 19v1.5',
  health: 'M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z',
  fixed: 'M12 21s6-5.7 6-11a6 6 0 10-12 0c0 5.3 6 11 6 11zM14 10a2 2 0 11-4 0 2 2 0 014 0z',
}

/** 고정 탭 줄의 분류 아이콘 타일(구독이 아닌 항목). 구독은 ServiceLogo를 쓴다 */
export function RecurringIcon({ kind, title, type, size = 34 }: { kind: RecurringKind; title: string; type: TxType; size?: number }) {
  const key = recurringIconKey({ kind, title, type })
  const d = key === 'subscription' ? PATHS.fixed : PATHS[key]
  return (
    <span className="svc-logo rc-icon" style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  )
}
