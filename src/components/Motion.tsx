import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckIcon } from './Icons'

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

/** 아래에서 올라오는 알림. 올라올 때 350ms, 사라질 때 250ms. done(저장·삭제를 마침)이면 글 앞 체크가 올라온 뒤 그려진다. */
export function Toast({ msg, done = false }: { msg: string; done?: boolean }) {
  const [shown, setShown] = useState({ text: '', done: false })
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (msg) {
      setShown({ text: msg, done })
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
      return () => cancelAnimationFrame(r)
    }
    setOn(false)
    const t = window.setTimeout(() => setShown({ text: '', done: false }), 300)
    return () => window.clearTimeout(t)
  }, [msg, done])
  // live region은 늘 그려 두고 글만 바꾼다. 글과 함께 나타나면 보조기기가 읽지 않는다
  return (
    <div className={`toast${on ? ' on' : ''}`} role="status" aria-live="polite">
      {shown.text && shown.done && <span className="toast-check" aria-hidden="true"><CheckIcon /></span>}
      {shown.text}
    </div>
  )
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

/**
 * 순서 바꾸기를 눈으로 따라가게 한다(FLIP): key가 바뀐 그 그림에서만, data-flip을 단 자식이 옛 자리에서 새 자리로 300ms에 옮겨 간다.
 * 사람이 한 일(메모 고정·풀기)에 답하는 움직임이라 찾기·거르기로 줄이 바뀔 때는 key를 바꾸지 않아 움직이지 않는다.
 * 자리는 목록 안 offset으로 재서 스크롤과 상관없다. 동작 줄이기면 움직이지 않고 바로 놓는다.
 */
export function useFlip<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null)
  const spots = useRef(new Map<string, { x: number; y: number }>())
  const prevKey = useRef(key)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const moved = prevKey.current !== key
    prevKey.current = key
    const next = new Map<string, { x: number; y: number }>()
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const id = child.dataset.flip
      if (!id) continue
      const at = { x: child.offsetLeft, y: child.offsetTop }
      next.set(id, at)
      const was = spots.current.get(id)
      if (!moved || !was || reduceMotion()) continue
      const dx = was.x - at.x
      const dy = was.y - at.y
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      child.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }
    spots.current = next
  })
  return ref
}

/**
 * 기다리던 결과가 도착한 그때 한 번, 줄마다 40ms씩 늦게 흐림 4px→0과 투명도로 들어온다(400ms, 앞 8줄까지).
 * Magic UI BlurFade(MIT, CREDITS.md)를 옮겼다: 위로 떠오르지 않고(DESIGN.md Motion "하지 않는 것"),
 * 처음부터 준비돼 있던 내용(탭 전환·같은 날 캐시)과 "더 보기"로 늘어난 줄은 움직이지 않는다. 동작 줄이기면 투명도만.
 */
export function useArrival<T extends HTMLElement>(ready: boolean) {
  const ref = useRef<T>(null)
  const was = useRef(ready)
  useLayoutEffect(() => {
    if (was.current === ready) return
    was.current = ready
    const el = ref.current
    if (!ready || !el) return
    const frames = reduceMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0)' }]
    Array.from(el.children).slice(0, 8).forEach((row, i) => {
      row.animate?.(frames, { duration: 400, delay: 40 + i * 40, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'backwards' })
    })
  }, [ready])
  return ref
}
