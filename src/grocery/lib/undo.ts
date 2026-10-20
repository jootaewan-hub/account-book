// 빼기 되돌리기 묶음(D-017, 사용자 결정 2026-10-20): 연달아 뺀 묶음(품목 하나 또는 분류 통째로)을 쌓아 "N개 뺐어요"로 보여 주고,
// 되돌리기는 마지막에 뺀 묶음부터 하나씩 되살린다. 실수로 눌렀을 때는 한 번에 살리고, 정리 중에는 그냥 둔다.
export type RemovedGroup = { ids: string[]; what: string }

export const pushGroup = (stack: readonly RemovedGroup[], group: RemovedGroup): RemovedGroup[] => [...stack, group]

/** 마지막 묶음을 꺼낸다. 비어 있으면 group은 null */
export function popGroup(stack: readonly RemovedGroup[]): { rest: RemovedGroup[]; group: RemovedGroup | null } {
  if (stack.length === 0) return { rest: [], group: null }
  return { rest: stack.slice(0, -1), group: stack[stack.length - 1] }
}

/** 지워진(되돌릴 수 없게 된) 품목을 묶음에서 뺀다. 빈 묶음은 사라진다 */
export function dropId(stack: readonly RemovedGroup[], id: string): RemovedGroup[] {
  return stack.map((g) => (g.ids.includes(id) ? { ...g, ids: g.ids.filter((x) => x !== id) } : g)).filter((g) => g.ids.length > 0)
}

/** 알림 글: 묶음이 하나면 전처럼 이름으로("삼겹살을 뺐어요."), 여럿이면 개수로("3개 뺐어요.") */
export function removedText(stack: readonly RemovedGroup[]): string {
  if (stack.length === 0) return ''
  if (stack.length === 1) return `${stack[0].what} 뺐어요.`
  return `${stack.reduce((n, g) => n + g.ids.length, 0)}개 뺐어요.`
}
