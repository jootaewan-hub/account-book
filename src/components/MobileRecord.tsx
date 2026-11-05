import { useEffect, useState } from 'react'
import { Plus } from './Icons'

const DIRECTION_THRESHOLD = 16

export function MobileRecord({ onClick }: { onClick: () => void }) {
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const mobile = window.matchMedia('(width < 960px)')
    let anchor = Math.max(0, window.scrollY)
    function followScroll() {
      const y = Math.max(0, window.scrollY)
      if (!mobile.matches || y <= DIRECTION_THRESHOLD) {
        anchor = y
        setCompact(false)
        return
      }
      const distance = y - anchor
      if (Math.abs(distance) < DIRECTION_THRESHOLD) return
      anchor = y
      setCompact(distance > 0)
    }
    window.addEventListener('scroll', followScroll, { passive: true })
    return () => window.removeEventListener('scroll', followScroll)
  }, [])

  return (
    <div className="mobile-record-row">
      <button className="primary mobile-record" type="button" aria-label="기록하기" data-compact={compact || undefined} onClick={onClick}>
        <Plus /><span aria-hidden="true">기록하기</span>
      </button>
    </div>
  )
}
