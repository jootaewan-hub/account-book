// 설정 '앱' 카드의 새 버전 확인·앱 파일 다시 받기, 홈 화면 설치 안내.
// virtual:pwa-register를 부르지 않아 시험(Vitest)에서 그대로 쓴다. 서비스 워커 등록과 자동 반영은 pwa.ts.
//
// 왜 따로 확인하나: 자동 반영은 서비스 워커가 새 sw.js를 알아챌 때만 일어난다. 홈 화면 앱(iOS)은 그 확인을 드물게 하고,
// GitHub Pages는 sw.js를 10분 캐시한다(cache-control max-age=600). 그래서 빌드마다 version.json(vite.config.ts)을 두고,
// 사람이 누르면 그 파일을 캐시 없이 읽어 지금 버전과 견준다. 다르면 서비스 워커와 앱 캐시를 지우고 새 주소로 다시 연다.

/** 다시 받은 뒤 주소에 붙이는 표시. 처음 탭을 고르기 전에 takeRefreshMark가 지운다 */
export const REFRESH_PARAM = 'u'

export type VersionCheck = { status: 'latest' | 'newer'; latest: string } | { status: 'failed' }

/** 서버에 있는 최신 버전(version.json)을 캐시 없이 읽어 지금 버전과 견준다. 못 읽으면 failed(인터넷·개발 서버) */
export async function checkVersion(current: string, opts: { base: string; fetch?: typeof fetch; now?: () => number }): Promise<VersionCheck> {
  const get = opts.fetch ?? fetch
  try {
    // 같은 주소면 CDN이 10분 동안 예전 파일을 줄 수 있어 매번 다른 주소로 묻는다
    const res = await get(`${opts.base}version.json?t=${(opts.now ?? Date.now)()}`, { cache: 'no-store' })
    if (!res.ok) return { status: 'failed' }
    const body = (await res.json()) as { version?: unknown } | null
    const latest = typeof body?.version === 'string' ? body.version.trim() : ''
    if (!latest) return { status: 'failed' }
    return { status: latest === current ? 'latest' : 'newer', latest }
  } catch {
    return { status: 'failed' }
  }
}

export type RefreshDeps = {
  sw?: Pick<ServiceWorkerContainer, 'getRegistrations'>
  caches?: Pick<CacheStorage, 'keys' | 'delete'>
  href: string
  go: (url: string) => void
  now: () => number
}

/**
 * 앱 파일 다시 받기: 서비스 워커를 내리고 앱 캐시(Cache Storage)를 지운 뒤, 캐시를 건너뛰는 주소로 다시 연다.
 * 로그인(localStorage)과 가계부 기록(서버)은 건드리지 않는다. 누를 때만 부른다(자동으로 부르면 CDN이 예전 파일을 주는 동안 되풀이된다).
 */
export async function refreshApp(d: RefreshDeps): Promise<void> {
  try {
    const regs = (await d.sw?.getRegistrations()) ?? []
    await Promise.all(regs.map((r) => r.unregister()))
  } catch { /* 못 내려도 아래 새 주소로 연다 */ }
  try {
    const keys = (await d.caches?.keys()) ?? []
    await Promise.all(keys.map((k) => d.caches!.delete(k)))
  } catch { /* 위와 같다 */ }
  const url = new URL(d.href)
  url.searchParams.set(REFRESH_PARAM, String(d.now()))
  d.go(url.toString())
}

let refreshed = false

/** 시작할 때 한 번(main.tsx, 처음 그리기 전): 다시 받기 표시를 주소에서 지우고 기억한다. 다른 값(?tab=grocery)은 그대로 둔다 */
export function takeRefreshMark(loc: Pick<Location, 'href'> = window.location, history: Pick<History, 'replaceState'> = window.history): boolean {
  const url = new URL(loc.href)
  if (!url.searchParams.has(REFRESH_PARAM)) return false
  url.searchParams.delete(REFRESH_PARAM)
  history.replaceState(null, '', url.pathname + url.search + url.hash)
  refreshed = true
  return true
}

/** 이번에 앱 파일을 다시 받고 열었는가(설정 탭으로 열고, 같은 버전이 또 오면 다시 받지 않고 기다리라고 한다) */
export function wasRefreshed(): boolean {
  return refreshed
}

// ── 홈 화면 설치 ─────────────────────────────────────────────

export type InstallKind = 'installed' | 'prompt' | 'ios' | 'android' | 'desktop'

/** 이 기기에서 보일 설치 안내. iOS에는 설치 창을 띄우는 방법이 없어 공유 메뉴를 안내한다 */
export function installKind(env: { standalone: boolean; ua: string; touchPoints: number; canPrompt: boolean }): InstallKind {
  if (env.standalone) return 'installed'
  if (env.canPrompt) return 'prompt'
  // iPadOS는 데스크톱 Safari처럼 Macintosh라고 하지만 터치가 된다
  if (/iPhone|iPad|iPod/.test(env.ua) || (/Macintosh/.test(env.ua) && env.touchPoints > 1)) return 'ios'
  if (/Android/.test(env.ua)) return 'android'
  return 'desktop'
}

/** 홈 화면 앱(설치한 앱)으로 열렸는가 */
export function isStandalone(win: Pick<Window, 'matchMedia' | 'navigator'> = window): boolean {
  return Boolean(win.matchMedia?.('(display-mode: standalone)').matches) || (win.navigator as { standalone?: boolean }).standalone === true
}

type PromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: PromptEvent | null = null
let installedNow = false
const installListeners = new Set<() => void>()
const emit = () => installListeners.forEach((fn) => fn())

/** 시작할 때 한 번: 안드로이드 크롬의 설치 창 이벤트를 받아 두었다가 설정의 '홈 화면에 설치'에서 띄운다 */
export function listenInstall(win: Pick<Window, 'addEventListener'> = window) {
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as PromptEvent
    emit()
  })
  win.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    emit()
  })
}

export function canPromptInstall(): boolean {
  return deferred !== null
}

/** 이번 실행 중에 설치했는가(appinstalled) */
export function installedThisSession(): boolean {
  return installedNow
}

export function onInstallChange(fn: () => void): () => void {
  installListeners.add(fn)
  return () => { installListeners.delete(fn) }
}

/** 받아 둔 설치 창을 띄운다. 한 번 쓰면 다시 못 쓴다(브라우저 규칙) */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  deferred = null
  emit()
  try {
    await e.prompt()
    return (await e.userChoice).outcome
  } catch {
    return 'unavailable'
  }
}
