// @vitest-environment jsdom
// 대화상자 공통 동작(src/lib/dialog.ts): Tab 순환, Esc는 맨 위 창만, 닫히면 연 버튼으로 포커스 복귀, 스크롤 잠금 수 세기.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusables, nextFocus, useClosing, useFocusTrap, useScrollLock } from '../../src/lib/dialog'

afterEach(cleanup)
beforeEach(() => {
  // jsdom에는 requestAnimationFrame이 없을 수 있어 바로 부르는 것으로 둔다
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

function Dialog({ active, onEscape, initialToSecond = false }: { active: boolean; onEscape?: () => void; initialToSecond?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const second = useRef<HTMLButtonElement>(null)
  useFocusTrap(root, active, { onEscape, initialFocus: initialToSecond ? second : undefined })
  return (
    <div ref={root} tabIndex={-1} role="dialog" aria-label="시험">
      <button>첫째</button>
      <button ref={second}>둘째</button>
      <button disabled>꺼짐</button>
      <input aria-label="글" />
    </div>
  )
}

const press = (key: string, shiftKey = false) => fireEvent.keyDown(document, { key, shiftKey })

describe('focusables·nextFocus', () => {
  it('꺼진 버튼과 숨긴 요소는 빼고 문서 순서로 모은다', () => {
    const { container } = render(<Dialog active={false} />)
    const root = container.firstElementChild as HTMLElement
    expect(focusables(root).map((el) => el.textContent || el.getAttribute('aria-label'))).toEqual(['첫째', '둘째', '글'])
  })
  it('끝에서는 반대쪽 끝으로 돌고, 창 밖에 있었으면 첫째(또는 마지막)로 간다', () => {
    const a = document.createElement('button'), b = document.createElement('button'), c = document.createElement('button')
    expect(nextFocus([a, b, c], c, false)).toBe(a)
    expect(nextFocus([a, b, c], a, true)).toBe(c)
    expect(nextFocus([a, b, c], document.body, false)).toBe(a)
    expect(nextFocus([a, b, c], document.body, true)).toBe(c)
    expect(nextFocus([], document.body, false)).toBeNull()
  })
})

describe('useFocusTrap', () => {
  it('열리면 창(또는 지정한 요소)에 포커스를 두고 Tab은 창 안에서만 돈다', () => {
    const opener = document.createElement('button')
    opener.textContent = '열기'
    document.body.appendChild(opener)
    opener.focus()
    const { getByText, getByLabelText, getByRole } = render(<Dialog active />)
    expect(document.activeElement).toBe(getByRole('dialog'))
    press('Tab')
    expect(document.activeElement).toBe(getByText('첫째'))
    press('Tab'); press('Tab')
    expect(document.activeElement).toBe(getByLabelText('글'))
    press('Tab')
    expect(document.activeElement).toBe(getByText('첫째'))
    press('Tab', true)
    expect(document.activeElement).toBe(getByLabelText('글'))
    opener.remove()
  })
  it('initialFocus를 주면 그 요소부터', () => {
    const { getByText } = render(<Dialog active initialToSecond />)
    expect(document.activeElement).toBe(getByText('둘째'))
  })
  it('Esc는 onEscape를 부르고, 한글 조합 중이면 무시한다', () => {
    const onEscape = vi.fn()
    render(<Dialog active onEscape={onEscape} />)
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(onEscape).not.toHaveBeenCalled()
    press('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
  it('겹쳐 열린 창은 맨 위 하나만 Esc·Tab을 받고, 위 창이 닫히면 아래 창이 다시 받는다', () => {
    const below = vi.fn(), above = vi.fn()
    function Two() {
      const [top, setTop] = useState(true)
      return <><Dialog active onEscape={below} />{top && <Dialog active onEscape={() => { above(); setTop(false) }} />}</>
    }
    render(<Two />)
    press('Escape')
    expect(above).toHaveBeenCalledTimes(1)
    expect(below).not.toHaveBeenCalled()
    press('Escape')
    expect(below).toHaveBeenCalledTimes(1)
  })
  it('닫히면(active=false) 열기 전에 포커스가 있던 요소로 되돌린다', () => {
    // requestAnimationFrame은 위에서 바로 부르게 바꿔 두었으니 setTimeout만 가짜로
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    function Host() {
      const [open, setOpen] = useState(true)
      return <><button onClick={() => setOpen(false)}>닫기</button>{open && <Dialog active />}</>
    }
    const { getByText, getByRole } = render(<Host />)
    expect(document.activeElement).toBe(getByRole('dialog'))
    act(() => { getByText('닫기').click() })
    act(() => { vi.runAllTimers() })
    expect(document.activeElement).toBe(opener)
    opener.remove()
    vi.useRealTimers()
  })
})

describe('useScrollLock·useClosing', () => {
  it('겹친 창의 잠금은 마지막 창이 사라질 때 풀린다', () => {
    function Lock({ on }: { on: boolean }) { useScrollLock(on); return null }
    const { rerender } = render(<><Lock on /><Lock on /></>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<><Lock on /><Lock on={false} /></>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<><Lock on={false} /><Lock on={false} /></>)
    expect(document.body.style.overflow).toBe('')
  })
  it('close()는 closing을 켜고 closeMs 뒤에 onClose를 한 번만 부른다', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const onClose = vi.fn()
    function C() {
      const { closing, close } = useClosing(onClose, 250)
      // 한 번 누른 뒤 닫히는 동안 또 눌러도 타이머는 하나만
      return <button onClick={() => { close(); close() }}>{closing ? '닫는 중' : '열림'}</button>
    }
    const { getByRole, getByText } = render(<C />)
    act(() => { getByRole('button').click() })
    act(() => { getByRole('button').click() })
    expect(getByText('닫는 중')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(250) })
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
