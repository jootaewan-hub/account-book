import { useEffect, useState } from 'react'
import { waitGroceryFlush } from '../grocery/flush'
import {
  canPromptInstall, checkVersion, installedThisSession, installKind, isStandalone, onInstallChange, promptInstall, refreshApp, wasRefreshed,
  type InstallKind, type VersionCheck,
} from '../lib/appUpdate'

// 설정 '앱' 카드: 지금 버전, 업데이트 확인(서버 version.json과 견주고 다르면 앱 파일을 새로 받아 다시 연다), 홈 화면 앱 설치 안내.
// 자동 반영(pwa.ts)이 늦거나 멈췄을 때 사람이 눌러 바로 새 버전을 받는 길이다.

export type AppDeps = {
  current: string
  check: () => Promise<VersionCheck>
  /** 서비스 워커·앱 캐시를 지우고 새 주소로 다시 연다(appUpdate.refreshApp) */
  refresh: () => Promise<void>
  /** 다시 열기 전에 장보기에서 뺀 품목의 지우기 요청이 서버에 닿기를 기다린다 */
  flush: () => Promise<void>
  refreshed: () => boolean
  install: () => InstallKind
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  onInstallChange: (fn: () => void) => () => void
  /** 휴대폰에서 열 주소(https:// 없이) */
  address: string
}

function defaultDeps(): AppDeps {
  const base = import.meta.env.BASE_URL
  return {
    current: __APP_VERSION__,
    check: () => checkVersion(__APP_VERSION__, { base }),
    refresh: () => refreshApp({
      sw: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
      caches: 'caches' in window ? window.caches : undefined,
      href: window.location.href,
      go: (url) => window.location.replace(url),
      now: Date.now,
    }),
    flush: waitGroceryFlush,
    refreshed: wasRefreshed,
    install: () => (installedThisSession() ? 'installed' : installKind({
      standalone: isStandalone(), ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints ?? 0, canPrompt: canPromptInstall(),
    })),
    promptInstall,
    onInstallChange,
    address: `${window.location.host}${base}`.replace(/\/$/, ''),
  }
}

type Phase = 'idle' | 'checking' | 'latest' | 'updating' | 'stale' | 'failed' | 'refreshed'

const BUTTON: Partial<Record<Phase, string>> = { checking: '새 버전 확인 중', updating: '새 버전 받는 중' }

export function AppCard({ toast, deps }: { toast: (msg: string) => void; deps?: Partial<AppDeps> }) {
  const [d] = useState<AppDeps>(() => ({ ...defaultDeps(), ...deps }))
  const [phase, setPhase] = useState<Phase>(() => (d.refreshed() ? 'refreshed' : 'idle'))
  const [latest, setLatest] = useState('')
  const [, rerender] = useState(0)
  useEffect(() => d.onInstallChange(() => rerender((n) => n + 1)), [d])
  const kind = d.install()

  async function reload() {
    setPhase('updating')
    try { await d.flush() } catch { /* 지우기 요청은 다음에 다시 보낸다 */ }
    await d.refresh()
  }

  async function update() {
    setPhase('checking')
    const r = await d.check()
    if (r.status === 'failed') return setPhase('failed')
    setLatest(r.latest)
    if (r.status === 'latest') return setPhase('latest')
    // 방금 새로 받았는데 또 다르면 CDN이 아직 예전 파일을 주는 것이다. 되풀이하지 않고 기다리라고 한다
    if (d.refreshed()) return setPhase('stale')
    await reload()
  }

  async function install() {
    const r = await d.promptInstall()
    if (r === 'accepted') toast("설치했어요. 홈 화면의 '가계부' 아이콘으로 열어 주세요")
  }

  const status = {
    idle: '',
    checking: '',
    latest: '지금이 최신 버전이에요.',
    updating: `서버에 새 버전(${latest})이 있어요. 앱 파일을 새로 받아 다시 열어요.`,
    stale: `앱 파일을 방금 새로 받았는데 서버에는 다른 버전(${latest})이 있어요. 올린 직후에는 몇 분 걸릴 수 있어요. 잠시 뒤에 다시 눌러 주세요.`,
    failed: '서버 버전을 확인하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.',
    refreshed: '앱 파일을 새로 받았어요.',
  }[phase]

  const installRight: Record<InstallKind, string> = { installed: '설치해서 쓰는 중', prompt: '', ios: '설치 전', android: '설치 전', desktop: '휴대폰에서' }
  const installNote: Record<InstallKind, string> = {
    installed: '',
    prompt: "설치하면 홈 화면의 '가계부' 아이콘으로 주소창 없이 바로 열려요.",
    ios: "Safari의 공유 버튼에서 '홈 화면에 추가'를 고르세요. 홈 화면의 '가계부' 아이콘으로 열면 주소창 없이 앱처럼 열려요. 아이콘으로 처음 열 때는 다시 로그인해야 해요.",
    android: "브라우저 메뉴(⋮)에서 '앱 설치'나 '홈 화면에 추가'를 고르세요. 홈 화면의 '가계부' 아이콘으로 열면 앱처럼 열려요.",
    desktop: `휴대폰 브라우저로 ${d.address} 주소를 열고 홈 화면에 추가하면 앱처럼 쓸 수 있어요.`,
  }
  const busy = phase === 'checking' || phase === 'updating'

  return (
    <div className="card app-card">
      <h2 className="section-title">앱</h2>
      <div className="set-row"><span>지금 버전</span><span className="r">{d.current}</span></div>
      <button className="ghost" style={{ width: '100%', marginTop: 8 }} disabled={busy} onClick={() => void update()}>
        {BUTTON[phase] ?? '업데이트 확인'}
      </button>
      <p className="app-status" role="status">{status}</p>
      {(phase === 'latest' || phase === 'stale') && (
        <p className="app-reset">
          <button className="link-btn" onClick={() => void reload()}>앱 파일 다시 받기</button>
          <span className="tx-meta">화면이 이상할 때만 눌러 주세요. 로그인과 기록은 그대로예요.</span>
        </p>
      )}
      <div className="set-row app-install">
        <span>홈 화면 앱</span>
        {kind === 'prompt'
          ? <button className="link-btn" onClick={() => void install()}>홈 화면에 설치</button>
          : <span className="r">{installRight[kind]}</span>}
      </div>
      {installNote[kind] && <p className="note">{installNote[kind]}</p>}
    </div>
  )
}
