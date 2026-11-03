// @vitest-environment jsdom
// 순서 바꾸기 움직임(useFlip, D-048): 사람이 고정·풀기를 한 그 그림에서만 옛 자리→새 자리로 옮겨 가고, 찾기로 줄이 바뀔 때는 움직이지 않는다.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFlip } from '../../src/components/Motion'

function List({ ids, flipKey }: { ids: string[]; flipKey: string }) {
  const ref = useFlip<HTMLUListElement>(flipKey)
  return <ul ref={ref}>{ids.map((id) => <li key={id} data-flip={id}>{id}</li>)}</ul>
}

const animate = vi.fn()
beforeEach(() => {
  animate.mockClear()
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true })
  // jsdom은 배치를 하지 않으니 목록 안 순서 × 100px을 자리로 준다
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get(this: HTMLElement) { return Array.from(this.parentElement?.children ?? []).indexOf(this) * 100 } })
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get: () => 0 })
})
afterEach(() => {
  cleanup()
  delete (Element.prototype as { animate?: unknown }).animate
  delete (HTMLElement.prototype as { offsetTop?: unknown }).offsetTop
  delete (HTMLElement.prototype as { offsetLeft?: unknown }).offsetLeft
})

it('key가 바뀐 그림에서만 자리를 옮긴 줄이 옛 자리에서 새 자리로 움직인다', () => {
  const { rerender } = render(<List ids={['a', 'b', 'c']} flipKey="" />)
  expect(animate).not.toHaveBeenCalled()
  rerender(<List ids={['c', 'a', 'b']} flipKey="c" />) // c를 고정해 맨 위로
  const moves = animate.mock.calls.map(([frames], i) => [(animate.mock.contexts[i] as HTMLElement).dataset.flip, frames[0].transform])
  expect(moves).toEqual([['c', 'translate(0px, 200px)'], ['a', 'translate(0px, -100px)'], ['b', 'translate(0px, -100px)']])
})

it('key가 그대로면(찾기·거르기로 줄이 줄거나 바뀜) 움직이지 않는다', () => {
  const { rerender } = render(<List ids={['a', 'b', 'c']} flipKey="a" />)
  rerender(<List ids={['b', 'c']} flipKey="a" />)
  rerender(<List ids={['c', 'b']} flipKey="a" />)
  expect(animate).not.toHaveBeenCalled()
})

it('움직임 줄이기를 켜면 움직이지 않고 바로 놓는다', () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
  try {
    const { rerender } = render(<List ids={['a', 'b']} flipKey="" />)
    rerender(<List ids={['b', 'a']} flipKey="b" />)
    expect(animate).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
