import { useId, useMemo, useRef, useState } from 'react'
import { useClosing, useFocusTrap, useScrollLock } from '../../lib/dialog'
import type { ListStore } from '../lib/store'
import { READING_TEXT } from '../lib/photo'
import { listText } from '../../../supabase/functions/grocery-photo/text'
import { PhotoPick } from './PhotoCapture'
import { NAME_MAX, parseLines, type ParsedItem } from '../lib/parse'

const CLOSE_MS = 250 // 가계부 Motion: 닫기는 여는 것(400ms)보다 빠르게

type Props = {
  onAdd: (items: ParsedItem[]) => Promise<void>
  /** 바코드 시트에서 넘어온 글처럼 처음부터 채워 둘 글 */
  initialText?: string
  /** 사진으로 담기(P6): 메모·냉장고·영수증 사진을 읽어 살 것 글로 채운다 */
  store?: ListStore
  /** 바코드로 담기(P6) */
  onBarcode?: () => void
  onClose: () => void
}

// 담기 시트. 휴대폰은 아래에서 올라오는 시트, 넓은 화면(960px 이상)은 가운데 창이다(CSS가 나눈다).
export default function AddSheet({ onAdd, onClose, initialText = '', store, onBarcode }: Props) {
  const [text, setText] = useState(initialText)
  const [reading, setReading] = useState(false)
  const [readMsg, setReadMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = useMemo(() => parseLines(text), [text])
  const area = useRef<HTMLTextAreaElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const hintId = useId()
  // 닫기 움직임·Esc·Tab 순환·스크롤 잠금·포커스 복귀는 공통 규칙(lib/dialog.ts). 처음 포커스는 글 칸
  const { closing, close } = useClosing(onClose, CLOSE_MS)
  useScrollLock(true)
  useFocusTrap(sheet, !closing, { onEscape: close, initialFocus: area })

  async function submit() {
    if (parsed.length === 0 || busy || closing) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(parsed)
    } catch {
      setError('담지 못했어요. 잠시 뒤 다시 해 주세요.')
      setBusy(false)
      return
    }
    // 담은 뒤에는 시트가 닫힐 때까지 busy를 풀지 않는다: 닫히는 동안 한 번 더 누르면 같은 품목이 두 번 담긴다.
    close()
  }

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>담기</h2>
          <button type="button" className="btn-text" onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          <label className="field-label" htmlFor={`${titleId}-text`}>살 것</label>
          <textarea
            id={`${titleId}-text`}
            ref={area}
            className="add-text"
            rows={4}
            value={text}
            placeholder="한 줄에 하나씩, 또는 쉼표로 나눠 적어요. 예: 양파, 당근, 비비고 왕교자 1.05kg x2"
            aria-describedby={hintId}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <p id={hintId} className="sr-only">한 줄에 하나씩, 또는 쉼표로 나눠 적어요. 예: 양파, 당근, 비비고 왕교자 1.05kg x2</p>
          {(store || onBarcode) && (
            <div className="photo-row add-tools">
              {store && (
                <PhotoPick
                  label="사진으로 담기"
                  inputLabel="목록 사진"
                  disabled={reading || busy}
                  className="btn-secondary detail-link"
                  onImage={(img) => {
                    setReading(true)
                    setReadMsg(null)
                    store.readPhoto('list', { media_type: img.media_type, data: img.data, width: img.width, height: img.height }).then(
                      (r) => {
                        setReading(false)
                        if (r.job !== 'list' || r.items.length === 0) {
                          setReadMsg('사진에서 살 것을 찾지 못했어요. 직접 적어 주세요.')
                          return
                        }
                        setText((t) => (t.trim() ? `${t.trimEnd()}\n` : '') + listText(r.items))
                        if (r.note) setReadMsg(r.note)
                      },
                      (e: unknown) => {
                        setReading(false)
                        setReadMsg(e instanceof Error && e.message ? e.message : '사진을 읽지 못했어요. 직접 적어 주세요.')
                      },
                    )
                  }}
                />
              )}
              {onBarcode && <button type="button" className="btn-secondary detail-link" disabled={busy} onClick={onBarcode}>바코드로 담기</button>}
              {reading && <span className="cand-state" role="status">{READING_TEXT}</span>}
            </div>
          )}
          {readMsg && <p className="cand-state" role="alert">{readMsg}</p>}
          {parsed.length > 0 && (
            <section className="preview" aria-label="담을 것 미리보기">
              <h3 className="preview-title">
                담을 것 <span className="num">{parsed.length}개</span>
              </h3>
              <ul className="preview-list">
                {parsed.map((p, i) => (
                  <li key={i} className="preview-row">
                    <span className="preview-name">
                      {p.name}
                      {p.spec && <span className="row-spec num"> {p.spec}</span>}
                      {p.specIsDefault && <span className="tag tag-default">기본</span>}
                      {p.count > 1 && <span className="row-count num"> ×{p.count}</span>}
                      {p.nameCut && <span className="preview-note">이름이 길어 {NAME_MAX}자까지만 담아요</span>}
                    </span>
                    <span className="tag">{p.category}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error && <p role="alert" className="form-error">{error}</p>}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn-primary btn-big" disabled={parsed.length === 0 || busy || closing} onClick={() => void submit()}>
            {busy ? '담는 중' : <><span className="num">{parsed.length}</span>개 담기</>}
          </button>
        </div>
      </div>
    </div>
  )
}
