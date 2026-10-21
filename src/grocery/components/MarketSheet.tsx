import { useId, useRef, type ReactNode } from 'react'
import { useClosing, useFocusTrap, useScrollLock } from '../../lib/dialog'

const CLOSE_MS = 250

/** 시세 상세처럼 내용만 바뀌는 시트(품목 상세와 같은 열기·닫기·초점 규칙, lib/dialog.ts) */
export default function MarketSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const { closing, close } = useClosing(onClose, CLOSE_MS)
  useScrollLock(true)
  useFocusTrap(sheet, !closing, { onEscape: close, initialFocus: closeBtn })

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet detail" ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
