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
  const [{ demoSeed }, { createMemoryStore }, { default: ListScreen }] = await Promise.all([
    import('./grocery/demo'),
    import('./grocery/lib/store'),
    import('./grocery/components/ListScreen'),
    import('./grocery/grocery.css'),
  ])
  const d = demoSeed()
  const full = mode === 'grocery'
  const memory = createMemoryStore(full ? d.items : [], d.me, undefined, full ? d.alerts : undefined, full ? d.prices : undefined)
  const store = mode === 'grocery-error' ? { ...memory, list: () => Promise.reject(new Error('데모: 불러오기 실패')) } : memory
  // 가계부 셸(아래 탭) 없이 장보기 화면만 본다: 아래 탭 높이를 0으로 두어 담기 바를 화면 맨 아래에 둔다
  const noTabbar = { '--tabbar-h': '0px' } as CSSProperties
  return <div className="wrap" style={noTabbar}><div className="grocery"><ListScreen store={store} me={d.me} /></div></div>
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
