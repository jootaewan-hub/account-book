import type { Category, Member, PaymentMethod, Scope, Spouse } from './types'

export type WhoColor = 'shared' | 'a' | 'b'

export const SCOPES: Scope[] = ['shared', 'husband', 'wife']
export const SCOPE_LABEL: Record<Scope, string> = { shared: '공동', husband: '남편', wife: '아내' }

export interface Lookup {
  me: string
  /** 내 역할. 아직 안 정했으면 null */
  myRole: Spouse | null
  members: Member[]
  methods: Map<string, PaymentMethod>
  categories: Map<string, Category>
  /** 사용자 id → 남편/아내 (모르면 null) */
  roleOf(userId: string | null | undefined): Spouse | null
  /** 사용자 id → '남편'/'아내', 모르면 표시 이름 */
  personLabel(userId: string | null | undefined): string
  colorOf(scope: Scope): WhoColor
  methodLabel(id: string | null): string
  categoryName(id: string | null): string
}

const opposite = (r: Spouse): Spouse => (r === 'husband' ? 'wife' : 'husband')

export function makeLookup(me: string, members: Member[], methods: PaymentMethod[], categories: Category[]): Lookup {
  const methodMap = new Map(methods.map((m) => [m.id, m]))
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const roleOf = (id: string | null | undefined): Spouse | null => {
    const m = members.find((x) => x.user_id === id)
    if (!m) return null
    if (m.spouse_role) return m.spouse_role
    // 한 사람만 역할을 정했으면 나머지는 반대 역할로 본다
    const other = members.find((x) => x.user_id !== id && x.spouse_role)
    return other?.spouse_role ? opposite(other.spouse_role) : null
  }
  return {
    me,
    myRole: roleOf(me),
    members,
    methods: methodMap,
    categories: catMap,
    roleOf,
    personLabel(id) {
      const r = roleOf(id)
      if (r) return SCOPE_LABEL[r]
      return members.find((m) => m.user_id === id)?.display_name ?? '알 수 없음'
    },
    colorOf(scope) {
      return scope === 'shared' ? 'shared' : scope === 'husband' ? 'a' : 'b'
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
