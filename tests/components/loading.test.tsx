// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ListView } from '../../src/components/ListView'
import { BootScreen, useAppear } from '../../src/components/Loading'
import { NotesCard } from '../../src/components/NotesCard'
import { makeLookup } from '../../src/lib/lookup'

afterEach(cleanup)
const lookup = makeLookup('me', [], [], [])

it('앱을 열 때는 앱 이름과 상태 문장, 처음 불러오기가 실패하면 같은 자리에 이유와 다시 시도', () => {
  const { rerender } = render(<BootScreen />)
  expect(screen.getByText('우리집 가계부')).toBeTruthy()
  expect(screen.getByRole('status').textContent).toBe('가계부 불러오는 중')
  const retry = vi.fn()
  rerender(<BootScreen error="인터넷 연결을 확인해 주세요." onRetry={retry} />)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('가계부를 불러오지 못했어요')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(retry).toHaveBeenCalledOnce()
})

it('내역을 받기 전에는 0원 대신 자리 표시를 보이고, 보조기기에는 상태 문장 하나만 읽힌다', () => {
  const props = { lookup, focus: null, onClearFocus: () => {}, onEdit: () => {}, onDeleteMany: async () => {} }
  const { container, rerender } = render(<ListView cur={[]} loading {...props} />)
  expect(container.textContent).not.toMatch(/0원/)
  expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['이 달 내역 불러오는 중'])
  expect(container.querySelector('.wait-tx')?.closest('[aria-hidden="true"]')).toBeTruthy()
  rerender(<ListView cur={[]} {...props} />)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByText('이 달에는 해당하는 내역이 없어요.')).toBeTruthy()
  expect(container.textContent).toMatch(/쓴 돈 0원/)
})

it('달력 화면 기억할 것 묶음도 불러오는 동안 자리 표시', () => {
  render(<NotesCard rows={null} error="" onOpenAll={() => {}} onOpen={() => {}} onNew={() => {}} onRetry={() => {}} />)
  expect(screen.getByRole('status').textContent).toBe('기억할 것 불러오는 중')
  expect(screen.queryByRole('button', { name: '적어 두기' })).toBeNull()
})

function Probe({ loading }: { loading: boolean }) {
  return <p data-testid="probe" className={useAppear(loading)} />
}

it('자리 표시를 보였던 화면만 내용이 흐림 교차로 들어온다(탭을 옮겨 다시 그릴 때는 그대로)', () => {
  const { rerender, unmount } = render(<Probe loading />)
  expect(screen.getByTestId('probe').className).toBe('')
  rerender(<Probe loading={false} />)
  expect(screen.getByTestId('probe').className).toBe('wait-done')
  unmount()
  render(<Probe loading={false} />)
  expect(screen.getByTestId('probe').className).toBe('')
})
