// 담기 칸과 "PC·맥에서 담기" 북마크릿 안내.
import { useRef, useState, type FormEvent } from 'react'

/** 북마크 줄에 넣을 글. 앱 주소는 이 앱이 열려 있는 주소다 */
export function bookmarkletText(): string {
  return `javascript:location.href='${window.location.origin}${import.meta.env.BASE_URL}?tab=recipes&add='+encodeURIComponent(location.href)`
}

export function AddBar({ busy, onSubmit }: { busy: boolean; onSubmit: (url: string) => Promise<boolean> }) {
  const [value, setValue] = useState('')
  const [bookmark, setBookmark] = useState(false)
  const [copied, setCopied] = useState<'done' | 'manual' | null>(null)
  const code = useRef<HTMLElement>(null)
  const text = bookmarkletText()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const url = value.trim()
    if (!url || busy) return
    if (await onSubmit(url)) setValue('')
  }
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard')
      await navigator.clipboard.writeText(text)
      setCopied('done')
    } catch {
      // 복사를 못 하는 브라우저: 글을 골라 두고 직접 복사하게 한다
      const el = code.current
      if (el) { const range = document.createRange(); range.selectNodeContents(el); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range) }
      setCopied('manual')
    }
  }

  return (
    <div className="rcp-add">
      <form className="rcp-add-form" onSubmit={(e) => void submit(e)}>
        <input className="rcp-input" type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          aria-label="유튜브 주소" placeholder="유튜브 주소 붙여넣기" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="rcp-btn rcp-btn-primary" type="submit" disabled={busy || !value.trim()}>담기</button>
      </form>
      <button className="rcp-btn-text" type="button" aria-expanded={bookmark} onClick={() => { setBookmark((x) => !x); setCopied(null) }}>PC·맥에서 담기</button>
      {bookmark && (
        <div className="rcp-bookmark">
          <p className="rcp-meta">아래 글을 북마크 주소에 넣어 두면, 유튜브 영상을 보다가 그 북마크를 눌러 담을 수 있어요. 이 앱에 로그인해 둔 브라우저에서만 돼요.</p>
          <code className="rcp-code" ref={code}>{text}</code>
          <div className="rcp-bookmark-actions">
            <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => void copy()}>복사</button>
            {copied === 'done' && <span className="rcp-meta" role="status">복사했어요</span>}
            {copied === 'manual' && <span className="rcp-meta" role="status">복사하지 못했어요. 위 글을 눌러 직접 복사해 주세요</span>}
          </div>
        </div>
      )}
    </div>
  )
}
