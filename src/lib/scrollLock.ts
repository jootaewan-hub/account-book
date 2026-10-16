// 시트가 열려 있는 동안 뒤 화면이 스크롤되지 않게 잠근다.
// 닫히는 시트는 280ms 동안 화면에 남아서 새로 여는 시트와 겹친다(기록하기 → 문자 붙여넣기).
// 시트마다 열 때의 값을 저장했다가 되돌리면 뒤에 연 시트가 'hidden'을 원래 값으로 알고 남겨 둔다.
// 그래서 잠근 수를 세고, 마지막 잠금이 풀릴 때만 처음 값으로 되돌린다.

type Style = { overflow: string }

const locks = new WeakMap<Style, { count: number; saved: string }>()

/** 잠그고, 푸는 함수를 돌려준다. 푸는 함수는 여러 번 불러도 한 번만 푼다 */
export function lockScroll(style: Style = document.body.style): () => void {
  const s = locks.get(style) ?? { count: 0, saved: '' }
  if (s.count === 0) {
    s.saved = style.overflow
    style.overflow = 'hidden'
  }
  s.count++
  locks.set(style, s)
  let released = false
  return () => {
    if (released) return
    released = true
    s.count--
    if (s.count === 0) style.overflow = s.saved
  }
}
