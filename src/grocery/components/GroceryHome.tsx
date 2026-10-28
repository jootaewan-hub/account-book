import { useState, type ComponentProps } from 'react'
import type { Category as LedgerCategory } from '../../lib/types'
import type { MarketStore } from '../lib/marketStore'
import type { Membership } from '../lib/membership'
import { loadGroceryView, saveGroceryView, type GroceryView } from '../lib/prefs'
import type { ListStore } from '../lib/store'
import ListScreen from './ListScreen'
import MarketScreen from './MarketScreen'
import { WishList } from './WishList'

/** 장보기 탭: 위쪽 "목록 | 시세" 전환(아래 탭은 늘리지 않는다, 통합 설계 3-2). 고른 쪽은 사람마다 기억한다 */
export default function GroceryHome({ store, market, me, ledger, wishes, dev }: {
  store: ListStore
  market: MarketStore
  me: Membership
  ledger?: { categories: LedgerCategory[]; onRecorded: () => void }
  wishes?: ComponentProps<typeof WishList>
  /** 개발용(데모 화면) */
  dev?: { barcode?: string }
}) {
  const [view, setView] = useState<GroceryView>(() => {
    const saved = loadGroceryView(me.userId)
    return saved === 'wishes' && !wishes ? 'list' : saved
  })
  const choose = (v: GroceryView) => {
    setView(v)
    saveGroceryView(me.userId, v)
  }
  return (
    <>
      <div className={`seg view-switch${wishes ? ' seg-3' : ''}`} role="group" aria-label="장보기 보기">
        <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>목록</button>
        <button type="button" aria-pressed={view === 'market'} onClick={() => choose('market')}>시세</button>
        {wishes && <button type="button" aria-pressed={view === 'wishes'} onClick={() => choose('wishes')}>보관함</button>}
      </div>
      {view === 'list'
        ? <ListScreen key={me.userId} store={store} me={me} ledger={ledger} market={market} dev={dev} />
        : view === 'wishes' && wishes ? <WishList {...wishes} /> : <MarketScreen store={market} />}
    </>
  )
}
