// 함께 기억할 것(D-038): 부부가 날짜 없이 기억해 둘 것을 적는 가구 공동 메모(public.notes).
// 날짜가 있는 일은 일정·기념일, 살 물건은 보관함을 쓴다.
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllPages } from '../../supabase/functions/_shared/pagination'

export const TITLE_MAX = 60
export const BODY_MAX = 2000
/** 달력 화면 묶음에 보이는 고정 메모 수 */
export const HOME_PINS = 3

export type NoteInput = { title: string; body: string | null; pinned: boolean }
export type Note = NoteInput & { id: string; created_by: string; updated_by: string; created_at: string; updated_at: string }

/** 고치는 사이 배우자가 먼저 고쳤거나 지웠다. 화면은 적던 내용을 지키고 "그래도 저장"을 고르게 한다 */
export class NoteConflict extends Error {}

export interface NoteStore {
  list(): Promise<Note[]>
  /** base가 있으면 그 메모를 고친다. force가 아니면 base를 읽은 뒤 다른 사람이 고쳤을 때 NoteConflict */
  save(input: NoteInput, base?: Note, force?: boolean): Promise<void>
  setPinned(id: string, pinned: boolean): Promise<void>
  remove(id: string): Promise<void>
  subscribe(changed: () => void): () => void
}

export function normalizeNote(input: NoteInput): NoteInput {
  const title = input.title.trim()
  if (!title) throw new Error('제목을 적어 주세요.')
  if (title.length > TITLE_MAX) throw new Error(`제목은 ${TITLE_MAX}자 안에서 적어 주세요.`)
  const body = input.body?.trim() || null
  if (body && body.length > BODY_MAX) throw new Error(`내용은 ${BODY_MAX.toLocaleString('ko-KR')}자 안에서 적어 주세요.`)
  return { title, body, pinned: input.pinned }
}

/** 고정한 것 먼저, 그 안에서는 최근에 고친 것 먼저(DB 정렬과 같다) */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/** 띄어 쓴 말이 제목·내용에 모두 들어 있는 메모 */
export function matchNotes(notes: Note[], query: string): Note[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return notes
  return notes.filter((n) => {
    const text = `${n.title}\n${n.body ?? ''}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
}

/** 내용의 첫 줄(빈 줄은 건너뛴다). 달력 화면 묶음의 둘째 줄 */
export function firstLine(body: string | null): string {
  return body?.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

/** "오늘", "어제", "10월 29일", 다른 해는 "2025년 3월 2일" (기기 현지 시간) */
export function noteWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  if (diff === 0) return '오늘'
  if (diff === 1) return '어제'
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}

/** 받침이 있으면 '이', 없으면 '가'. 한글로 끝나지 않으면 '이(가)' */
function subjectJosa(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  if (code < 0 || code > 11171) return '이(가)'
  return code % 28 ? '이' : '가'
}

/** 목록 아래 줄: "어제 아내가 고침" / "10월 29일 남편이 적음" */
export function noteByline(note: Note, personLabel: (id: string) => string, now: Date = new Date()): string {
  const edited = note.updated_by !== note.created_by || Date.parse(note.updated_at) - Date.parse(note.created_at) > 1000
  const who = personLabel(edited ? note.updated_by : note.created_by)
  return `${noteWhen(edited ? note.updated_at : note.created_at, now)} ${who}${subjectJosa(who)} ${edited ? '고침' : '적음'}`
}

const COLUMNS = 'id,title,body,pinned,created_by,updated_by,created_at,updated_at'

function checked<T>({ data, error }: { data: T; error: { code?: string; message: string } | null }): T {
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') throw new Error('함께 기억할 것 설정이 아직 적용되지 않았어요.')
    throw new Error(error.message)
  }
  return data
}

export function createNoteStore(client: SupabaseClient, householdId: string): NoteStore {
  const table = () => client.from('notes')
  return {
    async list() {
      try {
        return await readAllPages<Note>((from, to) => table().select(COLUMNS, { count: from === 0 ? 'exact' : undefined })
          .eq('household_id', householdId)
          .order('pinned', { ascending: false }).order('updated_at', { ascending: false }).order('id', { ascending: false })
          .range(from, to))
      } catch (e) {
        if (e instanceof Error && /notes/.test(e.message) && /schema cache|does not exist/.test(e.message)) throw new Error('함께 기억할 것 설정이 아직 적용되지 않았어요.', { cause: e })
        throw e
      }
    },
    async save(input, base, force = false) {
      const fields = normalizeNote(input)
      if (!base) {
        checked(await table().insert({ ...fields, household_id: householdId }).select('id').single())
        return
      }
      let q = table().update(fields).eq('household_id', householdId).eq('id', base.id)
      if (!force) q = q.eq('updated_at', base.updated_at)
      const { data, error } = await q.select('id')
      checked({ data, error })
      if (!data?.length) {
        if (force) throw new Error('배우자가 이 메모를 지웠어요. 새로 적어 주세요.')
        throw new NoteConflict('적는 사이 배우자가 이 메모를 먼저 고쳤거나 지웠어요.')
      }
    },
    async setPinned(id, pinned) {
      const { data, error } = await table().update({ pinned }).eq('household_id', householdId).eq('id', id).select('id')
      checked({ data, error })
      if (!data?.length) throw new Error('배우자가 이 메모를 지웠어요.')
    },
    async remove(id) {
      // 배우자가 먼저 지웠어도 지운 것과 같다
      checked(await table().delete().eq('household_id', householdId).eq('id', id))
    },
    subscribe(changed) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const update = () => { clearTimeout(timer); timer = setTimeout(changed, 250) }
      const filter = `household_id=eq.${householdId}`
      const channel = client.channel(`notes-${householdId}-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter }, update)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter }, update)
        // 삭제 이벤트에는 필터가 적용되지 않아 알림만 받고 새로 불러온다
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, update).subscribe()
      return () => { clearTimeout(timer); void client.removeChannel(channel) }
    },
  }
}
