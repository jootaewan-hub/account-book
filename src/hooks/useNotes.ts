import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError } from '../lib/api'
import { sortNotes, type Note, type NoteStore } from '../lib/notes'

/**
 * 함께 기억할 것 목록. 달력 화면 묶음과 기억할 것 화면이 같은 목록을 쓴다.
 * 배우자가 고치면 Realtime으로, 앱으로 돌아오면 다시 읽는다(iOS 홈 화면 앱은 백그라운드에서 연결이 끊길 수 있다).
 * 아직 못 읽었으면 rows는 null이다(빈 목록과 구별해 "없어요"로 보이지 않게).
 */
export function useNotes(store: NoteStore) {
  const [rows, setRows] = useState<Note[] | null>(null)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const reload = useCallback(async () => {
    const n = ++seq.current
    try {
      const all = await store.list()
      if (n === seq.current) { setRows(sortNotes(all)); setError('') }
    } catch (e) {
      if (n === seq.current) setError(friendlyError(e))
    }
  }, [store])
  useEffect(() => {
    void reload()
    const off = store.subscribe(() => void reload())
    const visible = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', visible)
    return () => { seq.current++; off(); document.removeEventListener('visibilitychange', visible) }
  }, [store, reload])
  return { rows, error, reload }
}
