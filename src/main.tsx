import { StrictMode, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startPwa } from './lib/pwa'
import './styles.css'

// 개발 서버에서만: 장보기 화면을 메모리 데이터로 연다(화면 캡처용, 가계부 셸 없이).
// ?demo=grocery(데모 목록), ?demo=grocery-empty(빈 목록), ?demo=grocery-error(목록 불러오기 실패).
// import.meta.env.DEV가 빌드에서 false로 바뀌어 이 분기와 데모 모듈은 빌드 결과에 들어가지 않는다.
async function devScreen(mode: string | null): Promise<ReactNode | null> {
  if (mode !== 'grocery' && mode !== 'grocery-empty' && mode !== 'grocery-error') return null
  const [{ demoSeed, demoMarket }, { createMemoryStore }, { createMemoryMarketStore }, { default: GroceryHome }] = await Promise.all([
    import('./grocery/demo'),
    import('./grocery/lib/store'),
    import('./grocery/lib/marketStore'),
    import('./grocery/components/GroceryHome'),
    import('./grocery/grocery.css'),
  ])
  const d = demoSeed()
  const full = mode === 'grocery'
  const memory = createMemoryStore(full ? d.items : [], d.me, undefined, full ? d.alerts : undefined, full ? d.prices : undefined)
  const store = mode === 'grocery-error' ? { ...memory, list: () => Promise.reject(new Error('데모: 불러오기 실패')) } : memory
  // 가계부 셸(아래 탭) 없이 장보기 화면만 본다: 아래 탭 높이를 0으로 두어 담기 바를 화면 맨 아래에 둔다
  const noTabbar = { '--tabbar-h': '0px' } as CSSProperties
  // 가계부에 넣기(D-011)를 보이게 가계부 분류 몇 개를 흉내 낸다(저장은 메모리 저장소)
  const categories = ['식비', '장보기', '세제·소모품', '생활용품', '기타'].map((name, i) => ({ id: `demo-c-${i}`, household_id: d.me.householdId, type: 'expense' as const, name, sort: i, archived: false }))
  // main.wrap: 가계부 셸처럼 아래 여백을 둬 목록 끝이 담기 바에 가리지 않게
  // 시세(D-012): 데모 시세(실제 조사값 아님). 빈 목록 데모는 시세도 비운다
  const market = createMemoryMarketStore(full ? demoMarket() : { board: { series: [], syncedAt: null } })
  return <main className="wrap" style={noTabbar}><div className="grocery"><GroceryHome store={store} market={market} me={d.me} ledger={{ categories, onRecorded: () => {} }} /></div></main>
}

const root = createRoot(document.getElementById('root')!)
const show = (screen: ReactNode) => root.render(<StrictMode>{screen}</StrictMode>)
const demo = new URLSearchParams(window.location.search).get('demo')
if (import.meta.env.DEV && demo) {
  void devScreen(demo).then((screen) => show(screen ?? <App />))
} else {
  show(<App />)
}

startPwa()
