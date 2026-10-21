// @vitest-environment jsdom
// 화면 시험 기반 확인: jsdom 위에서 React 컴포넌트를 그려 글자와 버튼을 찾을 수 있어야 한다.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { Toast } from '../../src/components/Motion'

afterEach(cleanup)

it('Toast는 문장을 role=status로 보여 준다', () => {
  render(<Toast msg="저장했어요" />)
  expect(screen.getByRole('status').textContent).toBe('저장했어요')
})

it('버튼 누르기 이벤트가 전달된다', () => {
  let n = 0
  render(<button onClick={() => { n++ }}>기록하기</button>)
  fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
  expect(n).toBe(1)
})
