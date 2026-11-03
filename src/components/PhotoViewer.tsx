import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap, useScrollLock } from '../lib/dialog'
import { Close } from './Icons'

/**
 * 사진 크게 보기(D-053): 화면을 덮는 어두운 바탕 위에 사진 한 장을 비율 그대로 가장 크게. 닫기 버튼·Esc·바탕 누르기로 닫는다.
 * 키보드·포커스·스크롤 잠금은 시트와 같은 규칙(lib/dialog.ts): 수정 시트 위에 열려도 맨 위 창만 키를 받는다.
 * 시트는 transform으로 움직여 그 안의 fixed 요소가 시트 안에 갇히므로 body에 따로 그린다(portal)
 */
export function PhotoViewer({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollLock(true)
  useFocusTrap(ref, true, { onEscape: onClose })
  return createPortal(
    <>
      <div className="photo-view-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} tabIndex={-1} className="photo-view" role="dialog" aria-modal="true" aria-label={label}>
        <img src={src} alt={label} />
        <button type="button" className="icon-btn photo-view-close" onClick={onClose} aria-label="닫기"><Close /></button>
      </div>
    </>,
    document.body,
  )
}
