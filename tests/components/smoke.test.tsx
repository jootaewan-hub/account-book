// @vitest-environment jsdom
// 화면 시험 기반 확인: jsdom 위에서 React 컴포넌트를 그려 글자와 버튼을 찾을 수 있어야 한다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Toast } from '../../src/components/Motion'

afterEach(cleanup)

it('Toast는 문장을 role=status로 보여 주고, 글이 없을 때도 live region은 남아 있다', () => {
  const { rerender } = render(<Toast msg="" />)
  expect(screen.getByRole('status').textContent).toBe('')
  rerender(<Toast msg="저장했어요" />)
  expect(screen.getByRole('status').textContent).toBe('저장했어요')
})

it('Toast done이면 문장 앞에 체크(읽지 않음)를 그리고, 아니면 그리지 않는다', () => {
  const { rerender } = render(<Toast msg="저장했어요" done />)
  const status = screen.getByRole('status')
  expect(status.textContent).toBe('저장했어요')
  expect(status.querySelector('.toast-check[aria-hidden="true"] svg')).toBeTruthy()
  rerender(<Toast msg="저장하지 못했어요" />)
  expect(status.querySelector('.toast-check')).toBeNull()
})

it('버튼 누르기 이벤트가 전달된다', () => {
  let n = 0
  render(<button onClick={() => { n++ }}>기록하기</button>)
  fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
  expect(n).toBe(1)
})
