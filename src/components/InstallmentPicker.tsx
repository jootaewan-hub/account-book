import { canSplitInstallment } from '../lib/api'
import { won } from '../lib/format'
import { installmentPlan } from '../lib/recurring'

const CHOICES = Array.from({ length: 35 }, (_, i) => i + 2) // 2~36개월

/** 일시불·할부 고르기. 할부면 달마다 나눠 넣을지 고른다 (직접 입력과 문자·사진 분석 결과에서 함께 쓴다) */
export function InstallmentPicker({ id, amount, months, split, onChange }: {
  id: string
  amount: number
  months: number | null
  split: boolean
  onChange: (p: { months?: number | null; split?: boolean }) => void
}) {
  const plan = months && canSplitInstallment(amount, months) ? installmentPlan(amount, months) : null
  const choices = months && !CHOICES.includes(months) ? [...CHOICES, months] : CHOICES
  return (
    <div className="field">
      <label htmlFor={id}>결제</label>
      <select id={id} className="input" value={months ?? 1}
        onChange={(e) => { const v = Number(e.target.value); onChange({ months: v >= 2 ? v : null }) }}>
        <option value={1}>일시불</option>
        {choices.map((m) => <option key={m} value={m}>{m}개월 할부</option>)}
      </select>
      {months && plan && (
        <label className="check">
          <input type="checkbox" checked={split} onChange={(e) => onChange({ split: e.target.checked })} />
          <span>
            달마다 나눠 넣기: 이 날짜에 <b className="num">{won(plan.first)}원</b>, 다음 달부터 {months - 1}번 <b className="num">{won(plan.rest)}원</b>씩
            (고정 탭의 할부로 날짜가 되면 자동으로 들어가요)
          </span>
        </label>
      )}
      {months && plan && !split && <span className="tx-meta">끄면 결제 금액 전체를 이 날짜에 넣어요.</span>}
      {months && !plan && amount > 0 && <span className="tx-meta">금액이 개월 수보다 작아 나눠 넣을 수 없어요. 전체를 이 날짜에 넣어요.</span>}
    </div>
  )
}
