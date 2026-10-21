// 대화상자(바닥 시트·가운데 창) 공통 동작. 가계부 Sheet와 장보기 시트 8개가 같은 규칙을 쓴다.
//  - 열려 있는 동안 Tab은 창 안에서만 돌고, Esc는 닫는다(한글 조합 중 Esc는 무시).
//  - 겹쳐 열린 창은 맨 위 하나만 키를 받는다(품목 상세 위의 고르기 시트, 닫히는 중인 시트 위의 새 시트).
//  - 열릴 때 포커스를 안으로 옮기고, 닫히면 열기 전에 포커스가 있던 요소(연 버튼)로 되돌린다.
//  - 뒤 화면 스크롤은 lockScroll로 잠근다(겹친 창 수를 세어 마지막에 푼다).
import { useEffect, useRef, useState, type RefObject } from 'react'
import { lockScroll } from './scrollLock'

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** 창 안에서 Tab으로 갈 수 있는 요소 (숨긴 것 제외, 문서 순서) */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true')
}

/** Tab(또는 Shift+Tab)을 눌렀을 때 다음에 포커스할 요소. 창 밖에 있었거나 끝이면 반대쪽 끝으로 돈다 */
export function nextFocus(list: readonly HTMLElement[], active: Element | null, backwards: boolean): HTMLElement | null {
  if (list.length === 0) return null
  const i = list.indexOf(active as HTMLElement)
  if (i < 0) return backwards ? list[list.length - 1] : list[0]
  return list[(i + (backwards ? -1 : 1) + list.length) % list.length]
}

// 열려 있는 창의 순서. 마지막이 맨 위다
const stack: symbol[] = []
const isTop = (token: symbol) => stack[stack.length - 1] === token

export interface FocusTrapOptions {
  /** 처음 포커스를 둘 요소. 없으면 창(root) 자체에 둔다(root에 tabIndex={-1}가 있어야 한다) */
  initialFocus?: RefObject<HTMLElement | null>
  /** Esc를 눌렀을 때. 없으면 Esc는 아무 일도 하지 않는다 */
  onEscape?: () => void
}

/**
 * active인 동안 root 안에 포커스를 가두고 Esc·Tab을 처리한다. active가 끝나면 열기 전 요소로 포커스를 되돌린다.
 * 닫히는 움직임 동안(active=false, 아직 화면에 있음)은 키를 받지 않아, 그 위에 새로 연 창이 키를 가져간다.
 */
export function useFocusTrap(root: RefObject<HTMLElement | null>, active: boolean, { initialFocus, onEscape }: FocusTrapOptions = {}) {
  const escRef = useRef(onEscape)
  useEffect(() => { escRef.current = onEscape }, [onEscape])
  const initialRef = useRef(initialFocus)
  useEffect(() => { initialRef.current = initialFocus }, [initialFocus])

  useEffect(() => {
    if (!active) return
    const token = Symbol('dialog')
    stack.push(token)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // 처음 그린 다음 프레임에 포커스를 옮긴다(여는 움직임이 transform을 바꾸는 동안 스크롤이 튀지 않게 preventScroll)
    const raf = requestAnimationFrame(() => {
      const target = initialRef.current?.current ?? root.current
      target?.focus({ preventScroll: true })
    })
    const onKey = (e: KeyboardEvent) => {
      if (!isTop(token) || !root.current) return
      if (e.key === 'Escape') {
        if (!e.isComposing) escRef.current?.()
        return
      }
      if (e.key === 'Tab') {
        const next = nextFocus(focusables(root.current), document.activeElement, e.shiftKey)
        if (!next) return
        e.preventDefault()
        next.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(token), 1)
      // 연 버튼이 아직 화면에 있고 포커스가 창 안(또는 어디에도 없음)이면 되돌린다. 다른 곳을 눌러 포커스가 이미 밖에 있으면 그대로 둔다
      const now = document.activeElement
      const inside = now && root.current ? root.current.contains(now) : now === null || now === document.body
      if (opener && inside && document.contains(opener)) window.setTimeout(() => opener.focus({ preventScroll: true }), 0)
    }
  }, [active, root])
}

/** 화면에 있는 동안(닫히는 중 포함) 뒤 화면 스크롤을 잠근다 */
export function useScrollLock(mounted: boolean) {
  useEffect(() => {
    if (!mounted) return
    return lockScroll()
  }, [mounted])
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * 스스로 닫히는 창(장보기 시트): close()를 부르면 closing이 true가 되어 닫는 움직임을 그리고, closeMs 뒤에 onClose로 화면에서 뺀다.
 * 동작 줄이기 설정이면 바로 뺀다. 두 번 불러도 한 번만 닫는다.
 */
export function useClosing(onClose: () => void, closeMs: number): { closing: boolean; close: () => void } {
  const [closing, setClosing] = useState(false)
  // 같은 렌더 안에서 두 번 불려도(버튼 두 번 누름) 타이머는 하나만
  const started = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const close = () => {
    if (started.current) return
    started.current = true
    setClosing(true)
    timer.current = window.setTimeout(() => onCloseRef.current(), reduceMotion() ? 0 : closeMs)
  }
  return { closing, close }
}
