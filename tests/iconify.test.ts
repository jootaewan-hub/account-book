import { describe, expect, it } from 'vitest'
import { checkCollection, componentName, creditRow, parseIconId, renderComponent, resolveIcon, toJsxChildren } from '../scripts/iconify-lib.mjs'

// 2026-11-03 api.iconify.design 실제 응답에서 자른 본문
const LUCIDE_WALLET = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></g>'
const LUCIDE_CIRCLE_DOT = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="10"/></g>'
const TABLER_RECEIPT = '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2l-2 2l-2-2l-2 2l-2-2zM9 7h6m-6 4h6m-2 4h2"/>'
const TABLER_COIN_FILLED = '<path fill="currentColor" d="M17 3.34A10 10 0 1 1 2 12"/>'

describe('Iconify 아이콘을 앱 아이콘으로 바꾸기', () => {
  it('Lucide의 감싼 <g>를 벗기고 표시 속성을 뺀다', () => {
    expect(toJsxChildren(LUCIDE_WALLET)).toBe('<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />')
    expect(toJsxChildren(LUCIDE_CIRCLE_DOT)).toBe('<circle cx="12" cy="12" r="1" /><circle cx="12" cy="12" r="10" />')
  })

  it('Tabler처럼 도형 하나에 표시 속성이 붙은 것도 같은 모양으로 바꾼다', () => {
    expect(toJsxChildren(TABLER_RECEIPT)).toBe('<path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-3-2l-2 2l-2-2l-2 2l-2-2zM9 7h6m-6 4h6m-2 4h2" />')
  })

  it('채운 아이콘, 두께가 다른 선, 모르는 요소·속성은 받지 않는다', () => {
    expect(() => toJsxChildren(TABLER_COIN_FILLED)).toThrow(/fill="currentColor"/)
    expect(() => toJsxChildren('<path fill="none" stroke="currentColor" stroke-width="1.5" d="M1 1h2"/>')).toThrow(/stroke-width/)
    expect(() => toJsxChildren('<g fill="none" stroke="currentColor"><animate attributeName="d"/></g>')).toThrow(/animate/)
    expect(() => toJsxChildren('<path fill="none" stroke="currentColor" onclick="x" d="M1 1"/>')).toThrow(/onclick/)
    expect(() => toJsxChildren('<path d="M1 1h2"/>')).toThrow(/선/)
  })

  it('남는 속성이 있는 <g>는 그대로 두고 닫는다', () => {
    expect(toJsxChildren('<g fill="none" stroke="currentColor" transform="rotate(45 12 12)"><path d="M1 1h2"/></g>'))
      .toBe('<g transform="rotate(45 12 12)"><path d="M1 1h2" /></g>')
  })

  it('세트는 lucide·tabler만, 채운 변형은 이름에서 막는다', () => {
    expect(parseIconId('lucide:piggy-bank')).toEqual({ prefix: 'lucide', name: 'piggy-bank' })
    expect(() => parseIconId('mdi:wallet')).toThrow(/쓰지 않는다/)
    expect(() => parseIconId('tabler:coin-filled')).toThrow(/채운/)
    expect(() => parseIconId('wallet')).toThrow(/세트:이름/)
  })

  it('세트 라이선스가 고정해 둔 값과 다르면 멈춘다', () => {
    expect(() => checkCollection('lucide', { lucide: { license: { spdx: 'ISC' }, height: 24 } })).not.toThrow()
    expect(() => checkCollection('lucide', { lucide: { license: { spdx: 'GPL-3.0' }, height: 24 } })).toThrow(/라이선스/)
    expect(() => checkCollection('tabler', { tabler: { license: { spdx: 'MIT' }, height: 16 } })).toThrow(/24/)
  })

  it('응답에서 아이콘을 꺼내고, 없는 이름·24 아닌 크기·변형 별칭은 거절한다', () => {
    const json = { prefix: 'lucide', width: 24, height: 24, icons: { wallet: { body: LUCIDE_WALLET } }, aliases: { purse: { parent: 'wallet' }, 'wallet-r': { parent: 'wallet', rotate: 1 } } }
    expect(resolveIcon(json, 'wallet')).toBe(LUCIDE_WALLET)
    expect(resolveIcon(json, 'purse')).toBe(LUCIDE_WALLET)
    expect(() => resolveIcon(json, 'wallet-r')).toThrow(/별칭/)
    expect(() => resolveIcon({ ...json, not_found: ['nope'] }, 'nope')).toThrow(/없다/)
    expect(() => resolveIcon({ ...json, width: 16, height: 16 }, 'wallet')).toThrow(/24×24/)
  })

  it('컴포넌트와 CREDITS 줄은 앱 선 두께와 라이선스 원문 위치를 적는다', () => {
    expect(componentName('cloud-sun')).toBe('CloudSunIcon')
    const code = renderComponent({ component: 'CloudSunIcon', prefix: 'lucide', name: 'cloud-sun', jsx: '<path d="M1 1" />' })
    expect(code).toContain('export const CloudSunIcon = () => (')
    expect(code).toContain('<svg {...base} strokeWidth={1.75}><path d="M1 1" /></svg>')
    expect(creditRow({ component: 'CloudSunIcon', prefix: 'lucide', name: 'cloud-sun', date: '2026-11-03' }))
      .toBe('| `CloudSunIcon` | Lucide `cloud-sun` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |')
  })
})
