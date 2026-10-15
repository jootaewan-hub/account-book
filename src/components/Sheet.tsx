import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Close } from './Icons'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

// 시트를 닫는 시간(--dur-quick)보다 조금 길게 기다렸다가 화면에서 뺀다
const CLOSE_MS = 280
// 끌어 내린 속도가 이보다 빠르면(px/ms) 거리와 상관없이 닫는다 (Emil Kowalski, Sonner/Vaul)
const FLICK = 0.11

/** 바닥 시트. 열 때 400ms로 올라오고 닫을 때 250ms로 내려간다. 손잡이 줄을 끌어 내려 닫을 수 있다(닫기 버튼도 항상 있다). */
export function Sheet({ open, title, onClose, children }: Props) {
  const [mounted, setMounted] = useState(open)
  const [on, setOn] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y0: number; t0: number; dy: number; id: number } | null>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // 처음 그린 다음 프레임에 'on'을 붙여야 transform 전환이 실제로 일어난다
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
      return () => cancelAnimationFrame(r)
    }
    setOn(false)
    const t = window.setTimeout(() => setMounted(false), CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!mounted) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [mounted, onClose])

  useEffect(() => {
    if (open && on) sheetRef.current?.focus({ preventScroll: true })
  }, [open, on])

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (drag.current || !open || (e.target as HTMLElement).closest('button')) return
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0, id: e.pointerId }
    e.currentTarget.setPointerCapture(e.pointerId)
    sheetRef.current?.classList.add('dragging')
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = sheetRef.current
    if (!d || !el || e.pointerId !== d.id) return
    let dy = e.clientY - d.y0
    // 위로 끌면 고무줄처럼 점점 덜 따라온다
    if (dy < 0) { const h = el.offsetHeight; dy = -(1 - 1 / ((-dy * 0.55) / h + 1)) * h }
    d.dy = dy
    el.style.transform = `translateY(${dy}px)`
    if (scrimRef.current) scrimRef.current.style.opacity = String(1 - Math.max(0, dy) / el.offsetHeight)
  }
  function onUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = sheetRef.current
    if (!d || !el || e.pointerId !== d.id) return
    drag.current = null
    const v = d.dy / Math.max(1, performance.now() - d.t0)
    el.classList.remove('dragging')
    // 손을 뗀 자리에서부터 CSS 전환이 이어지도록 인라인 값만 지운다
    el.style.removeProperty('transform')
    scrimRef.current?.style.removeProperty('opacity')
    if (d.dy > el.offsetHeight * 0.25 || (d.dy > 10 && v > FLICK)) onClose()
  }

  if (!mounted) return null
  const closing = !open
  return (
    <>
      <div ref={scrimRef} className={`scrim${on ? ' on' : ''}${closing ? ' closing' : ''}`} onClick={onClose} />
      <div ref={sheetRef} tabIndex={-1} className={`sheet${on ? ' on' : ''}${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="grab" />
          <div className="wrap">
            <div className="sheet-head">
              <h2>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="닫기"><Close /></button>
            </div>
          </div>
        </div>
        <div className="wrap">{children}</div>
      </div>
    </>
  )
}
