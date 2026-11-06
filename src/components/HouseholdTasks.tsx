import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { friendlyError } from '../lib/api'
import { readAllPages } from '../../supabase/functions/_shared/pagination'
import { shortDate } from '../lib/events'
import { sb } from '../lib/supabase'
import type { Member } from '../lib/types'
import { Sheet } from './Sheet'

type TaskInput = { title: string; due_on: string; assignee_id: string | null }
type Task = TaskInput & { id: string; completed_at: string | null; completed_by: string | null; updated_at: string }
const COLUMNS = 'id,title,due_on,assignee_id,completed_at,completed_by,updated_at'

export function HouseholdTasks({ householdId, members, today, selected, adding, onAdd, onCloseAdd }: {
  householdId: string; members: Member[]; today: string; selected: string
  adding: boolean; onAdd: () => void; onCloseAdd: () => void
}) {
  const [rows, setRows] = useState<Task[] | null>(null)
  const [error, setError] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const seq = useRef(0)
  const channel = useId()
  const load = useCallback(async () => {
    const id = ++seq.current
    try {
      const rows = await readAllPages<Task>((start, end) => sb().from('household_tasks')
        .select(COLUMNS, { count: start === 0 ? 'exact' : undefined }).eq('household_id', householdId)
        .order('completed_at', { nullsFirst: true }).order('due_on').order('id').range(start, end))
      if (id === seq.current) { setRows(rows); setError('') }
    } catch {
      if (id === seq.current) setError('할 일을 불러오지 못했어요.')
    }
  }, [householdId])

  useEffect(() => {
    void load()
    const client = sb()
    const feed = client.channel(`tasks:${householdId}:${channel}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_tasks', filter: `household_id=eq.${householdId}` }, () => void load()).subscribe()
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => {
      seq.current++
      document.removeEventListener('visibilitychange', visible)
      void client.removeChannel(feed)
    }
  }, [channel, householdId, load])

  const close = () => { setEditing(null); onCloseAdd() }
  const name = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? '함께'
  const matching = (rows ?? []).filter((task) => showCompleted || !task.completed_at)
  const visible = showAll ? matching : matching.slice(0, 4)

  async function toggle(task: Task) {
    if (busy) return
    setBusy(task.id)
    try {
      const { data, error } = await sb().from('household_tasks').update({ completed_at: task.completed_at ? null : new Date().toISOString() })
        .eq('id', task.id).eq('updated_at', task.updated_at).select('id').maybeSingle()
      if (error || !data) throw new Error(error?.message ?? '다른 기기에서 먼저 바뀐 할 일이에요.')
      await load()
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(null) }
  }

  return (
    <section className="card household-tasks" aria-label="함께 할 일">
      <div className="household-tasks-head">
        <h2 className="section-title">함께 할 일</h2>
        <button type="button" className="link-btn" onClick={onAdd}>할 일 추가</button>
      </div>
      {error && <div role="alert" className="banner">{error} <button type="button" className="link-btn" onClick={() => void load()}>다시 불러오기</button></div>}
      {!rows && !error && <p className="plan-note" role="status">할 일 불러오는 중</p>}
      {visible.length > 0 && <ul className="household-task-list">
        {visible.map((task) => <li key={task.id}>
          <input type="checkbox" checked={Boolean(task.completed_at)} disabled={busy !== null} aria-label={`${task.title} 완료`} onChange={() => void toggle(task)} />
          <button type="button" className="household-task-row" onClick={() => setEditing(task)}>
            <strong>{task.title}</strong>
            <span>{shortDate(task.due_on)} · {name(task.assignee_id)}{task.completed_at ? ` · 완료${task.completed_by ? ` (${name(task.completed_by)})` : ''}` : task.due_on < today ? ' · 기한 지남' : ''}</span>
          </button>
        </li>)}
      </ul>}
      {rows && matching.length === 0 && <p className="plan-note">{showCompleted ? '할 일이 없어요.' : '아직 남은 할 일이 없어요.'}</p>}
      <div className="household-tasks-actions">
        {(rows ?? []).some((task) => task.completed_at) && <button type="button" className="link-btn" aria-pressed={showCompleted} onClick={() => setShowCompleted(!showCompleted)}>{showCompleted ? '미완료만 보기' : '완료한 일도 보기'}</button>}
        {matching.length > 4 && <button type="button" className="link-btn" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? '접기' : `${matching.length - 4}개 더 보기`}</button>}
      </div>
      <Sheet open={adding || editing !== null} title={editing ? '할 일 고치기' : '할 일 추가'} onClose={close}>
        {(adding || editing) && <TaskForm key={editing?.id ?? selected} householdId={householdId} task={editing} selected={selected} members={members}
          onDone={async () => { close(); await load() }} />}
      </Sheet>
    </section>
  )
}

function TaskForm({ householdId, task, selected, members, onDone }: {
  householdId: string; task: Task | null; selected: string; members: Member[]; onDone: () => Promise<void>
}) {
  const [input, setInput] = useState<TaskInput>({ title: task?.title ?? '', due_on: task?.due_on ?? selected, assignee_id: task?.assignee_id ?? null })
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')

  async function save(remove = false) {
    if (busy || (!remove && (!input.title.trim() || !input.due_on))) return
    if (remove && !confirm) { setConfirm(true); return }
    setBusy(true); setError('')
    try {
      const table = sb().from('household_tasks')
      const fields = { ...input, title: input.title.trim() }
      const req = task
        ? (remove ? table.delete() : table.update(fields)).eq('id', task.id).eq('updated_at', task.updated_at)
        : table.insert({ ...fields, household_id: householdId })
      const { data, error } = await req.select('id').maybeSingle()
      if (error || !data) throw new Error(error?.message ?? '다른 기기에서 먼저 바뀐 할 일이에요. 다시 열어 주세요.')
      await onDone()
    } catch (e) { setError(friendlyError(e)); setBusy(false) }
  }

  return <form className="anniv-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
    <label className="field">할 일<input className="input" required maxLength={60} placeholder="예: 세탁물 찾기" value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></label>
    <label className="field">기한<input className="input" type="date" required value={input.due_on} onChange={(e) => setInput({ ...input, due_on: e.target.value })} /></label>
    <label className="field">담당자<select className="input" value={input.assignee_id ?? ''} onChange={(e) => setInput({ ...input, assignee_id: e.target.value || null })}>
      <option value="">함께</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
    </select></label>
    {error && <p className="err" role="alert">{error}</p>}
    <button className="primary" disabled={busy || !input.title.trim() || !input.due_on}>{task ? '고치기' : '추가'}</button>
    {task && <button type="button" className="danger" disabled={busy} onClick={() => void save(true)}>{confirm ? '한 번 더 눌러 삭제' : '삭제'}</button>}
  </form>
}
