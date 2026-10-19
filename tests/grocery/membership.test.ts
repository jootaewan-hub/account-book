import { describe, expect, it } from 'vitest'
import type { Member as LedgerMember } from '../../src/lib/types'
import { toMembership } from '../../src/grocery/lib/membership'

describe('membership', () => {
  it('본인 행이 없으면 null(가구 없음)', () => expect(toMembership('u1', [])).toBeNull())
  it('두 사람을 담는다', () => {
    const m = toMembership('u1', [
      { household_id: 'h', user_id: 'u1', display_name: '태완', spouse_role: 'husband' },
      { household_id: 'h', user_id: 'u2', display_name: '배우자', spouse_role: 'wife' },
    ])
    expect(m).toEqual({ userId: 'u1', householdId: 'h', members: [
      { userId: 'u1', displayName: '태완', spouseRole: 'husband' },
      { userId: 'u2', displayName: '배우자', spouseRole: 'wife' }] })
  })
  it('알 수 없는 spouse_role은 null', () => {
    const m = toMembership('u1', [{ household_id: 'h', user_id: 'u1', display_name: '나', spouse_role: 'other' }])
    expect(m?.members[0].spouseRole).toBeNull()
  })
  it('가계부가 불러온 구성원 행(Member)을 그대로 받는다', () => {
    const rows: LedgerMember[] = [
      { household_id: 'h', user_id: 'u1', display_name: '나', role: 'owner', spouse_role: 'wife' },
      { household_id: 'h', user_id: 'u2', display_name: '너', role: 'partner', spouse_role: null },
    ]
    expect(toMembership('u2', rows)).toEqual({ userId: 'u2', householdId: 'h', members: [
      { userId: 'u1', displayName: '나', spouseRole: 'wife' },
      { userId: 'u2', displayName: '너', spouseRole: null }] })
  })
})
