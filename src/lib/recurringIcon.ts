// 고정 탭 줄 아이콘(사용자 요청 2026-10-20): 구독은 서비스 로고(ServiceLogo), 그 밖의 고정지출·관리비·할부는 이름과 종류로 분류 아이콘을 고른다.
// 세금·보험·주거·대출·통신·교육·공과금·할부·수입·차·건강, 모르면 고정(핀). 그림은 components/RecurringIcon.tsx.
import type { RecurringKind, TxType } from './types'

export type RecurringIconKey =
  | 'subscription' | 'tax' | 'insurance' | 'home' | 'loan' | 'phone' | 'education' | 'utility' | 'installment' | 'income' | 'car' | 'health' | 'fixed'

// 앞에 있는 것이 먼저 맞는다: "자동차 취득세"는 세금, "주택담보대출 이자"는 대출
const KEYWORDS: readonly (readonly [RecurringIconKey, readonly string[]])[] = [
  ['tax', ['세금', '취득세', '재산세', '자동차세', '소득세', '주민세', '종부세', '종합부동산세', '부가세', '국세', '지방세', '과태료']],
  ['insurance', ['보험', '공제']],
  ['loan', ['대출', '이자', '상환', '원리금', '할부금']],
  ['home', ['월세', '전세', '임대료', '집세', '주차비']],
  ['phone', ['통신', '휴대폰', '핸드폰', '인터넷', '전화', 'kt', 'skt', 'lg u+', '유플러스', 'iptv']],
  ['education', ['학원', '교육', '수업', '등록금', '학비', '과외', '어린이집', '유치원']],
  ['utility', ['관리비', '공과금', '전기', '가스', '수도', '난방']],
  ['car', ['자동차', '차량', '리스', '렌트', '주유']],
  ['health', ['헬스', '운동', '병원', '약값', '피트니스', '요가', '필라테스']],
]

export function recurringIconKey(r: { title: string; kind: RecurringKind; type: TxType }): RecurringIconKey {
  if (r.kind === 'subscription') return 'subscription'
  if (r.kind === 'installment') return 'installment'
  if (r.type === 'income') return 'income'
  const t = r.title.toLowerCase().replace(/\s+/g, '')
  for (const [key, words] of KEYWORDS) if (words.some((w) => t.includes(w.replace(/\s+/g, '')))) return key
  if (r.kind === 'utility') return 'utility'
  return 'fixed'
}
