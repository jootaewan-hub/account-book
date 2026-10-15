import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 값이 바뀌면 제자리에서 흐림 교차로 바꿔 끼운다 (transitions.dev text-swap-soft). 위치는 움직이지 않는다. */
export function Soft({ value, className }: { value: string; className?: string }) {
  const [shown, setShown] = useState({ cur: value, old: null as string | null, swapping: false })
  const timer = useRef(0)

  useLayoutEffect(() => {
    if (value === shown.cur) return
    window.clearTimeout(timer.current)
    setShown({ cur: value, old: shown.cur, swapping: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (shown.old === null || shown.swapping) return
    const r = requestAnimationFrame(() => setShown((s) => ({ ...s, swapping: true })))
    timer.current = window.setTimeout(() => setShown((s) => ({ cur: s.cur, old: null, swapping: false })), 240)
    return () => cancelAnimationFrame(r)
  }, [shown.old, shown.swapping])

  return (
    <span className={`soft${shown.swapping ? ' swapping' : ''}${className ? ` ${className}` : ''}`}>
      {shown.old !== null && <span className="soft-old" aria-hidden="true">{shown.old}</span>}
      <span className={shown.old !== null ? 'soft-new' : undefined}>{shown.cur}</span>
    </span>
  )
}

/** 아래에서 올라오는 알림. 올라올 때 350ms, 사라질 때 250ms. */
export function Toast({ msg }: { msg: string }) {
  const [text, setText] = useState('')
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (msg) {
      setText(msg)
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
      return () => cancelAnimationFrame(r)
    }
    setOn(false)
    const t = window.setTimeout(() => setText(''), 300)
    return () => window.clearTimeout(t)
  }, [msg])
  return <div className={`toast${on ? ' on' : ''}`} role="status" aria-live="polite" hidden={!text}>{text}</div>
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** 키(예: 달)가 바뀌면 넘긴 방향에서 8px 들어오며 흐림이 걷힌다 (250ms). 동작 줄이기면 투명도만. */
export function useSlideIn<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null)
  const prev = useRef(key)
  useLayoutEffect(() => {
    if (prev.current === key) return
    const dir = key > prev.current ? 1 : -1
    prev.current = key
    const el = ref.current
    if (!el?.animate) return
    const frames = reduceMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: `translateX(${8 * dir}px)`, filter: 'blur(3px)' }, { opacity: 1, transform: 'translateX(0)', filter: 'blur(0)' }]
    el.animate(frames, { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
  }, [key])
  return ref
}
