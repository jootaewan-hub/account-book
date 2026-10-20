// 고정 탭 줄 아이콘(사용자 요청 2026-10-20): 구독은 서비스 로고, 그 밖은 이름·종류로 고른 분류 아이콘.
import { describe, expect, it } from 'vitest'
import { recurringIconKey } from '../src/lib/recurringIcon'

describe('recurringIconKey', () => {
  it.each([
    ['자동차 취득세 할부', 'fixed', 'expense', 'tax'], ['재산세', 'fixed', 'expense', 'tax'], ['종합소득세', 'fixed', 'expense', 'tax'],
    ['실비보험', 'fixed', 'expense', 'insurance'], ['월세', 'fixed', 'expense', 'home'], ['전세 이자', 'fixed', 'expense', 'loan'],
    ['주택담보대출 이자', 'fixed', 'expense', 'loan'], ['휴대폰 요금', 'fixed', 'expense', 'phone'], ['KT 인터넷', 'fixed', 'expense', 'phone'],
    ['피아노 학원', 'fixed', 'expense', 'education'], ['아파트 관리비', 'utility', 'expense', 'utility'], ['도시가스', 'fixed', 'expense', 'utility'],
    ['냉장고', 'installment', 'expense', 'installment'], ['월급', 'fixed', 'income', 'income'], ['기타 수입', 'fixed', 'income', 'income'],
    ['자동차 리스', 'fixed', 'expense', 'car'], ['헬스장', 'fixed', 'expense', 'health'], ['기타', 'fixed', 'expense', 'fixed'],
    ['넷플릭스', 'subscription', 'expense', 'subscription'],
  ] as const)('%s (%s, %s) → %s', (title, kind, type, key) => {
    expect(recurringIconKey({ title, kind, type })).toBe(key)
  })
})
