import { inkOn, serviceOf } from '../lib/services'

/** 구독 서비스 로고. 모르는 서비스는 이름 첫 글자 */
export function ServiceLogo({ name, size = 36 }: { name: string; size?: number }) {
  const s = serviceOf(name)
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
  if (!s) {
    return <span className="svc-logo unknown" style={{ ...box, fontSize: size * 0.42 }} aria-hidden="true">{name.trim().charAt(0) || '?'}</span>
  }
  const fg = inkOn(s.color)
  if (s.icon) {
    return (
      <span className="svc-logo" style={{ ...box, background: s.color }} role="img" aria-label={`${s.name} 로고`}>
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} aria-hidden="true"><path d={s.icon.path} fill={fg} /></svg>
      </span>
    )
  }
  const text = s.text ?? s.name.charAt(0)
  const fontSize = size * (text.length <= 2 ? 0.4 : text.length <= 4 ? 0.28 : 0.22)
  return (
    <span className="svc-logo" style={{ ...box, background: s.color, color: fg, fontSize }} role="img" aria-label={`${s.name} 로고`}>
      {text}
    </span>
  )
}
