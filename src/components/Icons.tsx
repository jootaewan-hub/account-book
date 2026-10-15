import type { AnnivKind } from '../lib/types'

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const ChevronLeft = () => <svg {...base} strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>
export const ChevronRight = () => <svg {...base} strokeWidth={2}><path d="M9 18l6-6-6-6" /></svg>
export const Close = () => <svg {...base} strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>
export const Plus = () => <svg {...base} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>
export const CalendarIcon = () => (
  <svg {...base} strokeWidth={1.8}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
)
export const ListIcon = () => (
  <svg {...base} strokeWidth={1.8}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
)
export const GearIcon = () => (
  <svg {...base} strokeWidth={1.8}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
)
export const ChartIcon = () => (
  <svg {...base} strokeWidth={1.8}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
)
export const RepeatIcon = () => (
  <svg {...base} strokeWidth={1.8}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 014-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 01-4 4H4" /></svg>
)
export const CameraIcon = () => (
  <svg {...base} strokeWidth={1.75}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
)

/** 기념일 종류별 아이콘: 케이크(생일), 하트(우리 둘), 초(추모), 별(그 밖) */
export const AnnivIcon = ({ kind }: { kind: AnnivKind }) => (
  <svg {...base} strokeWidth={1.8} aria-hidden="true">
    {kind === 'birthday' && <path d="M4 20h16M5 20v-6.5A1.5 1.5 0 016.5 12h11a1.5 1.5 0 011.5 1.5V20M5 16c1.2.9 2.6.9 3.8 0s2.6-.9 3.7 0 2.6.9 3.8 0 2.4-.9 2.7-.4M12 12V9M12 6.6c-.9-.9-.9-2 0-3 .9 1 .9 2.1 0 3z" />}
    {kind === 'couple' && <path d="M12 20s-7.5-4.6-7.5-10.2A4.1 4.1 0 0112 7.6a4.1 4.1 0 017.5 2.2C19.5 15.4 12 20 12 20z" />}
    {kind === 'memorial' && <path d="M8.5 21h7M10 21V11h4v10M12 11V8.6M12 6.4c-1-.9-1-2.1 0-3.2 1 1.1 1 2.3 0 3.2z" />}
    {kind === 'other' && <path d="M12 3.8l2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.7-5 2.7 1-5.6-4.1-4 5.6-.8z" />}
  </svg>
)
