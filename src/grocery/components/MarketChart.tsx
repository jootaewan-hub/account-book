import { koDay } from '../lib/alerts'
import { won } from '../lib/format'
import type { TrendPoint } from '../lib/market'

const DAY = 86400_000
const t = (on: string) => Date.parse(`${on}T00:00:00Z`)

/** 추이 선의 색: 처음 값보다 오르면 clay, 내리면 indigo, 같으면 ink-2(DESIGN 시세 등락). 색만으로 알리지 않도록 화면에는 글자 비교가 따로 있다 */
export function trendDir(points: TrendPoint[]): 'up' | 'down' | 'same' {
  const p = points.filter((x) => x.price !== null)
  if (p.length < 2) return 'same'
  const d = p[p.length - 1].price! - p[0].price!
  return d > 0 ? 'up' : d < 0 ? 'down' : 'same'
}

/**
 * 45일 추이: 선은 한 조사처의 조사값, 띠는 그날 서울·수원·성남 조사처들의 최저~최고. 숫자는 조사값 그대로 직접 적는다(범례 상자 없음).
 * 조사하지 않은 날(주말·공휴일)은 건너뛰고 날짜 간격대로 놓는다.
 */
export default function MarketChart({ points, where }: { points: TrendPoint[]; where: string }) {
  const line = points.filter((p) => p.price !== null) as (TrendPoint & { price: number })[]
  const band = points.filter((p) => p.low !== null && p.high !== null && p.markets > 1) as (TrendPoint & { low: number; high: number })[]
  if (line.length === 0) return <p className="detail-none">추이를 그릴 조사값이 없어요.</p>

  const W = 480
  const H = 160
  const padL = 6
  const padR = 6
  const top = 10
  const bottom = 10
  const t0 = t(points[0].on)
  const t1 = Math.max(t(points[points.length - 1].on), t0 + DAY)
  const values = [...line.map((p) => p.price), ...band.flatMap((p) => [p.low, p.high])]
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi === lo) {
    lo -= 1
    hi += 1
  }
  const x = (on: string) => padL + ((t(on) - t0) / (t1 - t0)) * (W - padL - padR)
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom)
  const bandPath = band.length > 1
    ? `M${band.map((p) => `${x(p.on).toFixed(1)},${y(p.high).toFixed(1)}`).join('L')}L${[...band].reverse().map((p) => `${x(p.on).toFixed(1)},${y(p.low).toFixed(1)}`).join('L')}Z`
    : null
  const linePath = line.map((p, i) => `${i ? 'L' : 'M'}${x(p.on).toFixed(1)},${y(p.price).toFixed(1)}`).join('')
  const last = line[line.length - 1]
  const maxP = line.reduce((m, p) => (p.price > m.price ? p : m))
  const minP = line.reduce((m, p) => (p.price < m.price ? p : m))
  const dir = trendDir(points)
  const label = `${koDay(line[0].on)}부터 ${koDay(last.on)}까지 ${where} 조사값, 가장 낮은 값 ${won(minP.price)}, 가장 높은 값 ${won(maxP.price)}, 마지막 ${won(last.price)}`

  return (
    <figure className="market-chart">
      <p className="mc-range num" aria-hidden="true">이 기간 최저 {won(minP.price)}, 최고 {won(maxP.price)}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line className="mc-base" x1={padL} x2={W - padR} y1={H - bottom} y2={H - bottom} />
        {bandPath && <path className="mc-band" d={bandPath} />}
        <path className={`mc-line is-${dir}`} d={linePath} />
        <circle className={`mc-dot is-${dir}`} cx={x(last.on)} cy={y(last.price)} r={3.5} />
      </svg>
      <div className="mc-dates num" aria-hidden="true">
        <span>{koDay(points[0].on)}</span>
        <span>{koDay(points[points.length - 1].on)}</span>
      </div>
      <figcaption className="mc-caption">
        <span className={`mc-key-line is-${dir}`} aria-hidden="true" /> {where} 조사값
        {bandPath && (
          <>
            <span className="mc-key-band" aria-hidden="true" /> 그날 서울·수원·성남 조사처 최저~최고
          </>
        )}
      </figcaption>
    </figure>
  )
}

/** 지켜보는 품목 줄의 작은 추이 선(숫자는 줄의 글자로 따로 쓴다) */
export function Sparkline({ points }: { points: TrendPoint[] }) {
  const line = points.filter((p) => p.price !== null) as (TrendPoint & { price: number })[]
  if (line.length < 2) return <span className="spark" aria-hidden="true" />
  const W = 72
  const H = 28
  const t0 = t(line[0].on)
  const t1 = Math.max(t(line[line.length - 1].on), t0 + DAY)
  const lo = Math.min(...line.map((p) => p.price))
  const hi = Math.max(...line.map((p) => p.price))
  const y = (v: number) => (hi === lo ? H / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (H - 6))
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${(2 + ((t(p.on) - t0) / (t1 - t0)) * (W - 4)).toFixed(1)},${y(p.price).toFixed(1)}`).join('')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path className={`mc-line is-${trendDir(points)}`} d={d} />
    </svg>
  )
}
