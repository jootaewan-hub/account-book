// 앱 새 버전 처리.
// 홈 화면에 추가한 앱(iOS)은 새 버전 확인을 드물게 하므로 앱으로 돌아올 때마다 확인한다.
// 새 버전이 준비되면 입력 중이 아닐 때는 바로 새로 고치고, 입력 중이면 알림 줄을 띄운다.
// 사람이 누르는 확인·다시 받기와 홈 화면 설치 안내는 appUpdate.ts(설정 '앱' 카드).
import { registerSW } from 'virtual:pwa-register'
import { listenInstall } from './appUpdate'

let ready = false
const listeners = new Set<() => void>()

export function updateReady(): boolean {
  return ready
}

export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function busy(): boolean {
  const tag = document.activeElement?.tagName
  return Boolean(document.querySelector('.sheet[role="dialog"]')) || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function startPwa() {
  listenInstall()
  registerSW({
    immediate: true,
    onNeedReload() {
      if (!busy()) return window.location.reload()
      ready = true
      listeners.forEach((fn) => fn())
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => { /* 오프라인이면 다음에 */ })
      })
    },
  })
}
