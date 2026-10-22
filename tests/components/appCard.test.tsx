// @vitest-environment jsdom
// 설정 '앱' 카드: 업데이트 확인 결과마다 문구와 동작, 기기별 홈 화면 설치 안내.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCard, type AppDeps } from '../../src/components/AppCard'
import type { VersionCheck } from '../../src/lib/appUpdate'

afterEach(cleanup)

const CUR = 'abc1234 · 10-22 11:16'
const NEW = 'def5678 · 10-22 12:30'

function setup(check: VersionCheck, over: Partial<AppDeps> = {}) {
  const log: string[] = []
  const toasts: string[] = []
  const deps: Partial<AppDeps> = {
    current: CUR,
    check: async () => check,
    refresh: async () => { log.push('refresh') },
    flush: async () => { log.push('flush') },
    refreshed: () => false,
    install: () => 'desktop',
    promptInstall: async () => 'accepted',
    onInstallChange: () => () => {},
    address: 'jootaewan-hub.github.io/account-book',
    ...over,
  }
  render(<AppCard toast={(m) => toasts.push(m)} deps={deps} />)
  return { log, toasts }
}
const press = () => fireEvent.click(screen.getByRole('button', { name: '업데이트 확인' }))

describe('업데이트 확인', () => {
  it('지금 버전을 보여 주고, 같으면 최신이라고 한 뒤 막혔을 때만 쓰는 다시 받기를 낸다', async () => {
    const { log } = setup({ status: 'latest', latest: CUR })
    expect(screen.getByText(CUR)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '앱 파일 다시 받기' })).toBeNull()
    press()
    expect(await screen.findByText('지금이 최신 버전이에요.')).toBeTruthy()
    expect(log).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '앱 파일 다시 받기' }))
    await screen.findByRole('button', { name: '새 버전 받는 중' })
    expect(log).toEqual(['flush', 'refresh'])
  })
  it('서버 버전이 다르면 장보기 지우기 요청을 기다린 뒤 앱 파일을 새로 받는다', async () => {
    const { log } = setup({ status: 'newer', latest: NEW })
    press()
    expect(await screen.findByText(`서버에 새 버전(${NEW})이 있어요. 앱 파일을 새로 받아 다시 열어요.`)).toBeTruthy()
    expect((screen.getByRole('button', { name: '새 버전 받는 중' }) as HTMLButtonElement).disabled).toBe(true)
    expect(log).toEqual(['flush', 'refresh'])
  })
  it('방금 새로 받았는데 또 다르면 되풀이하지 않고 잠시 뒤 다시 누르라고 한다', async () => {
    const { log } = setup({ status: 'newer', latest: NEW }, { refreshed: () => true })
    expect(screen.getByText('앱 파일을 새로 받았어요.')).toBeTruthy()
    press()
    expect(await screen.findByText(/올린 직후에는 몇 분 걸릴 수 있어요/)).toBeTruthy()
    expect(log).toEqual([])
  })
  it('서버 버전을 못 읽으면(인터넷) 아무것도 지우지 않고 알린다', async () => {
    const { log } = setup({ status: 'failed' })
    press()
    expect(await screen.findByText(/서버 버전을 확인하지 못했어요/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '앱 파일 다시 받기' })).toBeNull()
    expect(log).toEqual([])
  })
})

describe('홈 화면 앱', () => {
  it('아이폰은 공유 메뉴의 홈 화면에 추가와 다시 로그인을 안내한다', () => {
    setup({ status: 'failed' }, { install: () => 'ios' })
    expect(screen.getByText(/Safari의 공유 버튼에서 '홈 화면에 추가'를 고르세요/)).toBeTruthy()
    expect(screen.getByText(/다시 로그인해야 해요/)).toBeTruthy()
  })
  it('이미 홈 화면 앱이면 안내 없이 쓰는 중이라고만 한다', () => {
    setup({ status: 'failed' }, { install: () => 'installed' })
    expect(screen.getByText('설치해서 쓰는 중')).toBeTruthy()
    expect(screen.queryByText(/홈 화면에 추가/)).toBeNull()
  })
  it('컴퓨터에서는 휴대폰에서 열 주소를 알려 준다', () => {
    setup({ status: 'failed' })
    expect(screen.getByText('휴대폰 브라우저로 jootaewan-hub.github.io/account-book 주소를 열고 홈 화면에 추가하면 앱처럼 쓸 수 있어요.')).toBeTruthy()
  })
  it('설치 창을 받아 두었으면 버튼으로 띄우고, 설치하면 알린다', async () => {
    const { toasts } = setup({ status: 'failed' }, { install: () => 'prompt' })
    fireEvent.click(screen.getByRole('button', { name: '홈 화면에 설치' }))
    await screen.findByRole('button', { name: '홈 화면에 설치' })
    await new Promise((r) => setTimeout(r, 0))
    expect(toasts).toEqual(["설치했어요. 홈 화면의 '가계부' 아이콘으로 열어 주세요"])
  })
})
