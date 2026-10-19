// 가계부 안의 장보기 탭. 가계부가 이미 불러온 가구 구성원과 가계부 Supabase 클라이언트로 장보기 저장소를 만든다.
// 로그인·가구 확인·새 버전 확인은 가계부(App.tsx, lib/pwa.ts)가 한다.
import { useMemo } from 'react'
import { sb } from '../lib/supabase'
import type { Category, Member } from '../lib/types'
import GroceryHome from './components/GroceryHome'
import { toMembership } from './lib/membership'
import { createSupabaseMarketStore } from './lib/marketStore'
import { createSupabaseStore } from './lib/supabaseStore'
import './grocery.css'

export function GroceryTab({ userId, members, categories, onRecorded }: {
  userId: string
  members: Member[]
  /** 가계부 분류(장 본 것을 가계부에 넣을 때 고른다) */
  categories: Category[]
  /** 장보기에서 가계부에 넣은 뒤 가계부 내역을 다시 불러온다 */
  onRecorded: () => void
}) {
  // 구성원 목록이 다시 불러와져도 내용이 같으면 저장소(실시간 구독)를 새로 만들지 않는다
  const key = members.map((m) => `${m.household_id}:${m.user_id}:${m.display_name}:${m.spouse_role ?? ''}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const membership = useMemo(() => toMembership(userId, members), [userId, key])
  const store = useMemo(() => (membership ? createSupabaseStore(sb(), membership) : null), [membership])
  const market = useMemo(() => (membership ? createSupabaseMarketStore(sb(), membership.householdId) : null), [membership])
  return (
    <div className="grocery">
      {membership && store && market
        ? <GroceryHome key={userId} store={store} market={market} me={membership} ledger={{ categories, onRecorded }} />
        : <p className="lead">가구 정보 확인 중</p>}
    </div>
  )
}
