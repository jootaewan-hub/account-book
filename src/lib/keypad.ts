// 금액 키패드와 키보드 입력. 화면 키패드와 키보드가 같은 규칙으로 금액을 바꾼다.

/** 화면 키패드의 키: '0'~'9', '00', '⌫' */
export function pressKey(amount: string, k: string): string {
  if (k === '⌫') return amount.slice(0, -1)
  const next = amount + k
  return next.length <= 10 ? next.replace(/^0+/, '') : amount
}

export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

/** 한글 조합 중인 키 (Safari는 isComposing 대신 keyCode 229만 주기도 한다) */
const composing = (e: KeyLike) => e.isComposing === true || e.keyCode === 229

/** 키보드 키를 화면 키패드의 키로 바꾼다. 단축키(⌘R 등)와 한글 조합 중에는 null */
export function keypadKey(e: KeyLike): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey || composing(e)) return null
  if (/^[0-9]$/.test(e.key)) return e.key
  if (e.key === 'Backspace') return '⌫'
  return null
}

/** ⌘+Enter(Mac), Ctrl+Enter(그 밖)로 저장. 그냥 Enter는 고른 칩·버튼을 누르는 키라 쓰지 않는다 */
export const isSaveShortcut = (e: KeyLike) => e.key === 'Enter' && (e.metaKey === true || e.ctrlKey === true) && !composing(e)

/** 글자를 쓰는 칸에 커서가 있으면 숫자·Backspace를 그 칸에 맡긴다 */
export function isTextField(t: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable === true
}

/** 저장 단축키 안내에 쓰는 이름 */
export const saveKeyLabel = () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘+Enter' : 'Ctrl+Enter')
