// @vitest-environment jsdom
// ErrorBoundary: 한 화면이 그리다 던지면 그 자리에 오류와 다시 시도를 보이고, 다시 시도하면 다시 그린다.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'

afterEach(cleanup)
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })

let fail = true
function Risky() {
  if (fail) throw new Error('그리기 실패')
  return <p>잘 그렸어요</p>
}

it('던지면 화면 이름과 오류 문장, 다시 시도 버튼을 보인다', () => {
  fail = true
  render(<ErrorBoundary name="통계"><Risky /></ErrorBoundary>)
  expect(screen.getByRole('alert').textContent).toContain('통계 화면을 그리지 못했어요')
  expect(screen.getByRole('alert').textContent).toContain('그리기 실패')
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy()
})

it('다시 시도를 누르면 자식을 다시 그린다', () => {
  fail = true
  render(<ErrorBoundary name="통계"><Risky /></ErrorBoundary>)
  fail = false
  act(() => { screen.getByRole('button', { name: '다시 시도' }).click() })
  expect(screen.getByText('잘 그렸어요')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('던지지 않으면 자식을 그대로 보인다', () => {
  fail = false
  render(<ErrorBoundary name="통계"><Risky /></ErrorBoundary>)
  expect(screen.getByText('잘 그렸어요')).toBeTruthy()
})
