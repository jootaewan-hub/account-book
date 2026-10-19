// 가계부 안의 장보기 탭. 가계부가 이미 불러온 가구 구성원과 가계부 Supabase 클라이언트로 장보기 저장소를 만든다.
// 로그인·가구 확인·새 버전 확인은 가계부(App.tsx, lib/pwa.ts)가 한다.
import { useMemo } from 'react'
import { sb } from '../lib/supabase'
import type { Member } from '../lib/types'
import ListScreen from './components/ListScreen'
import { toMembership } from './lib/membership'
import { createSupabaseStore } from './lib/supabaseStore'
import './grocery.css'

export function GroceryTab({ userId, members }: { userId: string; members: Member[] }) {
  // 구성원 목록이 다시 불러와져도 내용이 같으면 저장소(실시간 구독)를 새로 만들지 않는다
  const key = members.map((m) => `${m.household_id}:${m.user_id}:${m.display_name}:${m.spouse_role ?? ''}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const membership = useMemo(() => toMembership(userId, members), [userId, key])
  const store = useMemo(() => (membership ? createSupabaseStore(sb(), membership) : null), [membership])
  return (
    <div className="grocery">
      {membership && store
        ? <ListScreen key={userId} store={store} me={membership} />
        : <p className="lead">가구 정보 확인 중</p>}
    </div>
  )
}
