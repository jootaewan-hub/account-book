// 사람마다 기억하는 화면 설정. 브라우저 저장소가 없거나 막혀 있으면 기본값으로 둔다(실패해도 화면은 그대로 쓴다).
export type ListViewMode = 'category' | 'where'

const key = (userId: string) => `grocery:listView:${userId}`

export function loadListView(userId: string): ListViewMode {
  try {
    const v = globalThis.localStorage?.getItem(key(userId))
    return v === 'where' ? 'where' : 'category'
  } catch {
    return 'category'
  }
}

export function saveListView(userId: string, v: ListViewMode): void {
  try {
    globalThis.localStorage?.setItem(key(userId), v)
  } catch {
    // 저장소가 막혀 있으면 기억하지 않는다
  }
}

/** 장보기 탭 위 전환: 목록 | 시세(D-012, 통합 설계 3-2) */
export type GroceryView = 'list' | 'market'
const viewKey = (userId: string) => `grocery:view:${userId}`

export function loadGroceryView(userId: string): GroceryView {
  try {
    return globalThis.localStorage?.getItem(viewKey(userId)) === 'market' ? 'market' : 'list'
  } catch {
    return 'list'
  }
}

export function saveGroceryView(userId: string, v: GroceryView): void {
  try {
    globalThis.localStorage?.setItem(viewKey(userId), v)
  } catch {
    // 저장소가 막혀 있으면 기억하지 않는다
  }
}
