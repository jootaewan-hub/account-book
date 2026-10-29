// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { NotesCard } from '../../src/components/NotesCard'
import { NoteSheet } from '../../src/components/NoteSheet'
import { NotesView } from '../../src/components/NotesView'
import { makeLookup } from '../../src/lib/lookup'
import { NoteConflict, normalizeNote, sortNotes, type Note, type NoteStore } from '../../src/lib/notes'

const at = '2026-10-28T01:00:00Z'
const office: Note = { id: 'office', title: '관리사무소', body: '031-000-0000\n평일 9~6시', pinned: true, created_by: 'me', updated_by: 'me', created_at: at, updated_at: at }
const filter: Note = { id: 'filter', title: '정수기 필터', body: '석 달마다 바꾸기', pinned: false, created_by: 'you', updated_by: 'you', created_at: at, updated_at: at }
const lookup = makeLookup('me', [
  { household_id: 'h', user_id: 'me', display_name: '태완', role: 'owner', spouse_role: 'husband' },
  { household_id: 'h', user_id: 'you', display_name: '배우자', role: 'partner', spouse_role: 'wife' },
] as never, [], [])

/** 실제 저장소처럼 base의 updated_at이 다르면 NoteConflict */
function memory(initial: Note[] = []) {
  let rows = structuredClone(initial)
  let n = 0
  const store: NoteStore = {
    list: async () => sortNotes(structuredClone(rows)),
    async save(input, base, force) {
      const fields = normalizeNote(input)
      const stamp = `2026-10-29T0${++n}:00:00Z`
      if (!base) { rows.push({ ...fields, id: `new${n}`, created_by: 'me', updated_by: 'me', created_at: stamp, updated_at: stamp }); return }
      const cur = rows.find((r) => r.id === base.id)
      if (!cur || (!force && cur.updated_at !== base.updated_at)) throw new NoteConflict('적는 사이 배우자가 이 메모를 먼저 고쳤거나 지웠어요.')
      Object.assign(cur, fields, { updated_by: 'me', updated_at: stamp })
    },
    async setPinned(id, pinned) { rows = rows.map((r) => (r.id === id ? { ...r, pinned } : r)) },
    async remove(id) { rows = rows.filter((r) => r.id !== id) },
    subscribe: () => () => {},
  }
  return { store, edit: (id: string, patch: Partial<Note>) => { rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } }
}
afterEach(cleanup)

it('달력 묶음은 고정한 메모만 첫 줄과 함께 보이고, 없으면 고정 안내·적기 안내를 보인다', () => {
  const noop = () => {}
  const { rerender } = render(<NotesCard rows={[office, filter]} error="" onOpenAll={noop} onOpen={noop} onNew={noop} onRetry={noop} />)
  expect(screen.getByRole('button', { name: /관리사무소/ }).textContent).toContain('031-000-0000')
  expect(screen.queryByText('정수기 필터')).toBeNull()
  expect(screen.getByRole('button', { name: '2개 모두 보기' })).toBeTruthy()
  rerender(<NotesCard rows={[filter]} error="" onOpenAll={noop} onOpen={noop} onNew={noop} onRetry={noop} />)
  expect(screen.getByText(/고정하면 여기에 보여요/)).toBeTruthy()
  rerender(<NotesCard rows={[]} error="" onOpenAll={noop} onOpen={noop} onNew={noop} onRetry={noop} />)
  expect(screen.getByRole('button', { name: '적어 두기' })).toBeTruthy()
  rerender(<NotesCard rows={null} error="연결 끊김" onOpenAll={noop} onOpen={noop} onNew={noop} onRetry={noop} />)
  expect(screen.getByRole('alert').textContent).toContain('불러오지 못했어요')
})

it('기억할 것 화면에서 찾고, 고정을 누르면 저장소에 맞게 바뀐다', async () => {
  const { store } = memory([office, filter])
  let rows = await store.list()
  const toggle = async (n: Note) => { await store.setPinned(n.id, !n.pinned); rows = await store.list() }
  const view = () => <NotesView rows={rows} error="" lookup={lookup} onRetry={() => {}} onNew={() => {}} onOpen={() => {}} onTogglePin={toggle} />
  const { rerender } = render(view())
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText(/아내가 적음/)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('기억할 것 찾기'), { target: { value: '석 달' } })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  const item = screen.getByRole('listitem')
  fireEvent.click(within(item).getByRole('button', { name: '고정' }))
  await waitFor(() => expect(rows.find((r) => r.id === 'filter')?.pinned).toBe(true))
  rerender(view())
  expect(within(screen.getByRole('listitem')).getByRole('button', { name: '고정 풀기' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(screen.getByLabelText('기억할 것 찾기'), { target: { value: '없는 말' } })
  expect(screen.getByText(/들어간 메모가 없어요/)).toBeTruthy()
})

it('새로 적으면 고정 여부와 함께 저장한다', async () => {
  const { store } = memory()
  let msg = ''
  render(<NoteSheet note={null} store={store} onSaved={(m) => { msg = m }} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '정수기 필터' } })
  fireEvent.change(screen.getByLabelText('내용'), { target: { value: '석 달마다' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }))
  await waitFor(() => expect(msg).toBe('적어 두었어요'))
  expect(await store.list()).toMatchObject([{ title: '정수기 필터', body: '석 달마다', pinned: true }])
})

it('고치는 사이 배우자가 먼저 고쳤으면 적은 내용을 지키고, 그래도 저장을 고를 수 있다', async () => {
  const { store, edit } = memory([office])
  let msg = ''
  render(<NoteSheet note={office} store={store} onSaved={(m) => { msg = m }} onClose={() => {}} />)
  edit('office', { body: '배우자가 고친 내용', updated_by: 'you', updated_at: '2026-10-28T05:00:00Z' })
  fireEvent.change(screen.getByLabelText('내용'), { target: { value: '내가 고친 내용' } })
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }))
  expect((await screen.findByRole('alert')).textContent).toContain('먼저 고쳤거나 지웠어요')
  expect((screen.getByLabelText('내용') as HTMLTextAreaElement).value).toBe('내가 고친 내용')
  expect((await store.list())[0].body).toBe('배우자가 고친 내용')
  fireEvent.click(screen.getByRole('button', { name: '그래도 내 내용으로 저장' }))
  await waitFor(() => expect(msg).toBe('고쳤어요'))
  expect((await store.list())[0].body).toBe('내가 고친 내용')
})

it('지우기는 두 번 눌러야 지운다', async () => {
  const { store } = memory([office])
  let msg = ''
  render(<NoteSheet note={office} store={store} onSaved={(m) => { msg = m }} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '지우기' }))
  expect(await store.list()).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '한 번 더 누르면 지워요' }))
  await waitFor(() => expect(msg).toBe('지웠어요'))
  expect(await store.list()).toEqual([])
})
