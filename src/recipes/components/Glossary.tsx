// 용어 풀이: 재료·단계 글에서 그 말에 밑줄을 긋고, 누르면 작은 창에 풀이와 출처(덧붙임 또는 영상 m:ss)를 보인다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clock, originLabel, videoAt } from '../lib/display'

export type GlossaryEntry = { term: string; body: string; origin: string; at_seconds: number | null }
type Ctx = { entries: readonly GlossaryEntry[]; videoUrl: string | null; open: string | null; toggle: (id: string, el: HTMLElement) => void; close: () => void }
const GlossaryCtx = createContext<Ctx>({ entries: [], videoUrl: null, open: null, toggle: () => {}, close: () => {} })

export function GlossaryProvider({ entries, videoUrl, children }: { entries: readonly GlossaryEntry[]; videoUrl: string | null; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const close = useCallback(() => { setOpen(null); opener.current?.focus() }, [])
  const toggle = useCallback((id: string, el: HTMLElement) => {
    opener.current = el
    setOpen((cur) => (cur === id ? null : id))
    if (open === id) el.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); opener.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  const value = useMemo(() => ({ entries, videoUrl, open, toggle, close }), [entries, videoUrl, open, toggle, close])
  return <GlossaryCtx.Provider value={value}>{children}</GlossaryCtx.Provider>
}

type Piece = { text: string; term?: GlossaryEntry }

/** 글 한 덩이에서 용어마다 처음 나온 자리만 잘라 낸다. 겹치면 먼저 나온 것(같으면 긴 것)을 둔다 */
export function splitTerms(text: string, entries: readonly GlossaryEntry[]): Piece[] {
  const hits = entries
    .map((e) => ({ e, at: e.term ? text.indexOf(e.term) : -1 }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at || b.e.term.length - a.e.term.length)
  const out: Piece[] = []
  let pos = 0
  const seen = new Set<string>()
  for (const { e, at } of hits) {
    if (at < pos || seen.has(e.term)) continue
    seen.add(e.term)
    if (at > pos) out.push({ text: text.slice(pos, at) })
    out.push({ text: e.term, term: e })
    pos = at + e.term.length
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out.length ? out : [{ text }]
}

function Source({ entry, videoUrl }: { entry: GlossaryEntry; videoUrl: string | null }) {
  if (entry.origin === 'editor') return <span className="rcp-edit-mark">덧붙임</span>
  if (entry.at_seconds !== null && videoUrl) {
    return <a className="rcp-link" href={videoAt(videoUrl, entry.at_seconds)} target="_blank" rel="noopener noreferrer">영상 {clock(entry.at_seconds)}</a>
  }
  return <span className="rcp-origin">{originLabel(entry.origin as never, entry.at_seconds)}</span>
}

/** blockId는 화면에서 이 글 덩이를 가리키는 이름(같은 말이 여러 덩이에 있어도 따로 열린다) */
export function GlossaryText({ blockId, text }: { blockId: string; text: string }) {
  const { entries, videoUrl, open, toggle, close } = useContext(GlossaryCtx)
  const pieces = useMemo(() => splitTerms(text, entries), [text, entries])
  return (
    <>
      {pieces.map((p, i) => {
        if (!p.term) return <span key={i}>{p.text}</span>
        const id = `${blockId}:${p.term.term}`
        const isOpen = open === id
        return (
          <span key={i} className="rcp-term-wrap">
            <button type="button" className="rcp-term" aria-expanded={isOpen} onClick={(e) => toggle(id, e.currentTarget)}>{p.text}</button>
            {isOpen && (
              <span className="rcp-pop" role="dialog" aria-label={`${p.term.term} 풀이`}>
                <span className="rcp-pop-body">{p.term.body}</span>
                <span className="rcp-pop-foot"><Source entry={p.term} videoUrl={videoUrl} /><button type="button" className="rcp-btn-text" onClick={close}>닫기</button></span>
              </span>
            )}
          </span>
        )
      })}
    </>
  )
}
