import { won } from '../lib/format'

/** ▲ 23원 (+1.4%). 오름은 흙빛, 내림은 쪽빛, 같으면 글자만(장보기 DESIGN의 시세 등락 규칙, D-012). 색만으로 알리지 않는다 */
export function PriceDelta({ diff, pct, unit = '원' }: { diff: number; pct: number | null; unit?: string }) {
  if (diff === 0) return <span className="muted">같아요</span>
  const abs = Math.abs(diff)
  return (
    <span className={`num ${diff > 0 ? 'delta-up' : 'delta-down'}`}>
      {diff > 0 ? '▲' : '▼'} {abs >= 100 ? won(abs) : abs.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}{unit}{pct !== null && ` (${diff > 0 ? '+' : ''}${pct}%)`}
    </span>
  )
}
