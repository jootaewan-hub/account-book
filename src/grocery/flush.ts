// 장보기의 빼기 요청(서버 지우기)을 가계부 로그아웃이 기다릴 수 있게 모아 둔다.
// 세션이 먼저 끝나면 지우기 요청이 거부되어 뺀 품목이 되살아나므로, 로그아웃은 waitGroceryFlush() 뒤에 한다.
const inFlight = new Set<Promise<unknown>>()

/** 지우기 요청을 등록하고 그대로 돌려준다 */
export function trackGroceryFlush<T>(p: Promise<T>): Promise<T> {
  inFlight.add(p)
  const done = () => { inFlight.delete(p) }
  p.then(done, done)
  return p
}

/** 등록된 요청이 모두 끝날 때까지 기다린다. 실패한 요청도 기다림만 끝낸다 */
export async function waitGroceryFlush(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight])
}
