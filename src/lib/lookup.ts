import type { Category, Member, PaymentMethod, Transaction } from './types'

export type WhoColor = 'shared' | 'a' | 'b'

export interface Lookup {
  me: string
  members: Member[]
  methods: Map<string, PaymentMethod>
  categories: Map<string, Category>
  nameOf(userId: string | null | undefined): string
  colorOf(key: string): WhoColor
  /** 'shared' 또는 사용자 id → 화면 이름 */
  whoLabel(key: string): string
  methodLabel(id: string | null): string
  categoryName(id: string | null): string
}

export function makeLookup(me: string, members: Member[], methods: PaymentMethod[], categories: Category[]): Lookup {
  const methodMap = new Map(methods.map((m) => [m.id, m]))
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const nameOf = (id: string | null | undefined) => members.find((m) => m.user_id === id)?.display_name ?? '알 수 없음'
  return {
    me,
    members,
    methods: methodMap,
    categories: catMap,
    nameOf,
    colorOf(key) {
      if (key === 'shared') return 'shared'
      return members.find((m) => m.user_id === key)?.role === 'partner' ? 'b' : 'a'
    },
    whoLabel(key) {
      return key === 'shared' ? '공동' : nameOf(key)
    },
    methodLabel(id) {
      const m = id ? methodMap.get(id) : undefined
      if (!m) return '결제수단 없음'
      return m.last4 ? `${m.name} ··${m.last4}` : m.name
    },
    categoryName(id) {
      return (id && catMap.get(id)?.name) || '미분류'
    },
  }
}

export function txScopeKey(t: Pick<Transaction, 'scope' | 'scope_user_id'>): string {
  return t.scope === 'shared' ? 'shared' : (t.scope_user_id as string)
}
