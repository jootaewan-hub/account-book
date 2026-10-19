import type { Member } from './types'

// 장보기 화면이 쓰는 구성원 정보. 가계부가 이미 불러온 구성원 행(useLedgerMeta().members)으로 만든다.
export type Membership = { userId: string; householdId: string; members: Member[] }

// 가계부 public.members 행 중 장보기가 쓰는 열(가계부 src/lib/types.ts의 Member와 같은 이름)
export type MemberRow = { household_id: string; user_id: string; display_name: string; spouse_role: string | null }

// 본인 행이 없으면 가구가 없는 것이다.
export function toMembership(userId: string, rows: MemberRow[]): Membership | null {
  const mine = rows.find((r) => r.user_id === userId)
  if (!mine) return null
  const members = rows
    .filter((r) => r.household_id === mine.household_id)
    .map((r): Member => ({
      userId: r.user_id,
      displayName: r.display_name,
      spouseRole: r.spouse_role === 'husband' || r.spouse_role === 'wife' ? r.spouse_role : null,
    }))
  return { userId, householdId: mine.household_id, members }
}
