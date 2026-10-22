// 설정 '앱' 카드의 순수 부분: 서버 버전 견주기, 앱 파일 다시 받기, 다시 받은 표시 지우기, 기기별 설치 안내.
import { describe, expect, it } from 'vitest'
import { checkVersion, installKind, refreshApp, REFRESH_PARAM, takeRefreshMark, wasRefreshed } from '../src/lib/appUpdate'

const NOW = 1_792_640_000_000
const reply = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('checkVersion', () => {
  it('version.json을 매번 다른 주소와 캐시 없이 읽는다(휴대폰 브라우저가 10분 동안 예전 파일을 주지 않게)', async () => {
    const calls: [string, RequestInit | undefined][] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ version: 'abc1234 · 10-22 11:16' }))
    }) as typeof globalThis.fetch
    await checkVersion('x', { base: '/account-book/', fetch, now: () => NOW })
    expect(calls).toEqual([[`/account-book/version.json?t=${NOW}`, { cache: 'no-store' }]])
  })
  it('같으면 latest, 다르면 newer(서버 버전과 함께)', async () => {
    const v = 'abc1234 · 10-22 11:16'
    expect(await checkVersion(v, { base: '/', fetch: reply(200, { version: v }) })).toEqual({ status: 'latest', latest: v })
    expect(await checkVersion('old0000 · 10-21 09:00', { base: '/', fetch: reply(200, { version: v }) })).toEqual({ status: 'newer', latest: v })
  })
  it('못 읽으면 failed: 404, 모양이 다른 응답, 네트워크 오류', async () => {
    expect(await checkVersion('v', { base: '/', fetch: reply(404, 'not found') })).toEqual({ status: 'failed' })
    expect(await checkVersion('v', { base: '/', fetch: reply(200, '<html>') })).toEqual({ status: 'failed' })
    expect(await checkVersion('v', { base: '/', fetch: reply(200, { version: '' }) })).toEqual({ status: 'failed' })
    expect(await checkVersion('v', { base: '/', fetch: async () => { throw new TypeError('Failed to fetch') } })).toEqual({ status: 'failed' })
  })
})

describe('refreshApp', () => {
  it('서비스 워커를 모두 내리고 앱 캐시를 모두 지운 뒤, 표시를 붙인 주소로 다시 연다(?tab=grocery는 그대로)', async () => {
    const log: string[] = []
    await refreshApp({
      sw: { getRegistrations: async () => [1, 2].map((n) => ({ unregister: async () => { log.push(`unregister ${n}`); return true } }) as unknown as ServiceWorkerRegistration) },
      caches: { keys: async () => ['workbox-precache-v2', 'other'], delete: async (k: string) => { log.push(`delete ${k}`); return true } },
      href: 'https://jootaewan-hub.github.io/account-book/?tab=grocery',
      go: (url) => log.push(`go ${url}`),
      now: () => NOW,
    })
    expect(log).toEqual(['unregister 1', 'unregister 2', 'delete workbox-precache-v2', 'delete other', `go https://jootaewan-hub.github.io/account-book/?tab=grocery&${REFRESH_PARAM}=${NOW}`])
  })
  it('서비스 워커나 캐시를 못 다뤄도(지원 안 함·오류) 다시 연다', async () => {
    const went: string[] = []
    await refreshApp({
      sw: { getRegistrations: async () => { throw new Error('SecurityError') } },
      caches: undefined,
      href: 'https://x.test/account-book/',
      go: (url) => went.push(url),
      now: () => NOW,
    })
    expect(went).toEqual([`https://x.test/account-book/?${REFRESH_PARAM}=${NOW}`])
  })
})

describe('takeRefreshMark', () => {
  it('표시가 없으면 주소를 건드리지 않는다', () => {
    const replaced: string[] = []
    expect(takeRefreshMark({ href: 'https://x.test/account-book/?tab=grocery' }, { replaceState: (_s, _t, u) => { replaced.push(String(u)) } })).toBe(false)
    expect(replaced).toEqual([])
    expect(wasRefreshed()).toBe(false)
  })
  it('표시만 지우고 다른 값과 #은 남긴 뒤, 다시 받은 것으로 기억한다', () => {
    const replaced: string[] = []
    expect(takeRefreshMark({ href: `https://x.test/account-book/?tab=grocery&${REFRESH_PARAM}=1#top` }, { replaceState: (_s, _t, u) => { replaced.push(String(u)) } })).toBe(true)
    expect(replaced).toEqual(['/account-book/?tab=grocery#top'])
    expect(wasRefreshed()).toBe(true)
  })
})

describe('installKind', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  const env = (ua: string, over: Partial<Parameters<typeof installKind>[0]> = {}) => ({ standalone: false, ua, touchPoints: 0, canPrompt: false, ...over })
  it('홈 화면 앱으로 열렸으면 설치 안내를 내지 않는다', () => {
    expect(installKind(env(IPHONE, { standalone: true, touchPoints: 5 }))).toBe('installed')
    expect(installKind(env(ANDROID, { standalone: true, canPrompt: true }))).toBe('installed')
  })
  it('설치 창을 받아 두었으면(안드로이드 크롬) 버튼, 아이폰·아이패드는 공유 메뉴, 그 밖의 안드로이드는 메뉴, 컴퓨터는 휴대폰 안내', () => {
    expect(installKind(env(ANDROID, { canPrompt: true }))).toBe('prompt')
    expect(installKind(env(IPHONE, { touchPoints: 5 }))).toBe('ios')
    expect(installKind(env(IPAD, { touchPoints: 5 }))).toBe('ios')
    expect(installKind(env(ANDROID))).toBe('android')
    expect(installKind(env(MAC))).toBe('desktop')
    expect(installKind(env(IPAD))).toBe('desktop') // 터치가 없는 Mac Safari
  })
})
