// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobProgress, LINE_MS, progressAt, STAGE_INFO, STAGE_ORDER } from '../../src/recipes/components/JobProgress'

describe('진행 표시', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T01:00:00Z')) })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('단계 순서는 서버 함수의 일곱 단계와 같다', () => {
    expect(STAGE_ORDER).toEqual(['영상 정보 받는 중', '자막 받는 중', '말 받아쓰는 중', '화면 글자 읽는 중', '레시피 정리 중', '다시 읽어 맞춰 보는 중', '저장 중'])
  })

  it('막대는 단계 안에서만 차오르고 다음 단계 시작 값을 넘지 않으며, 단계가 뒤일수록 크다', () => {
    let prevTo = 0
    for (const s of STAGE_ORDER) {
      const { from, to } = STAGE_INFO[s]!
      expect(from).toBeGreaterThanOrEqual(prevTo)
      expect(progressAt(s, 0)).toBe(from)
      expect(progressAt(s, 10_000)).toBe(to)
      expect(progressAt(s, 30)).toBeGreaterThanOrEqual(from)
      prevTo = to
    }
    expect(progressAt('저장 중', 1e6)).toBeLessThan(100)
  })

  it('문구가 몇 초마다 바뀌고, 단계·걸린 시간·막대 값을 보인다', () => {
    render(<JobProgress stage="레시피 정리 중" claimedAt="2026-11-20T00:58:00Z" />)
    const lines = STAGE_INFO['레시피 정리 중']!.lines
    expect(screen.getByText(lines[0]!)).toBeTruthy()
    expect(screen.getByText(/5\/7단계 · 2분째/)).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45')
    act(() => { vi.advanceTimersByTime(LINE_MS) })
    expect(screen.getByText(lines[1]!)).toBeTruthy()
    act(() => { vi.advanceTimersByTime(120_000) })
    const v = Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
    expect(v).toBeGreaterThan(45)
    expect(v).toBeLessThanOrEqual(82)
  })

  it('"AI"·"분석"이라는 말을 쓰지 않는다', () => {
    const all = [...STAGE_ORDER.flatMap((s) => STAGE_INFO[s]!.lines)].join(' ')
    expect(all).not.toMatch(/AI|분석/)
  })
})
