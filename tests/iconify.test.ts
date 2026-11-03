import { describe, expect, it } from 'vitest'
import { checkCollection, componentName, creditRow, parseIconId, renderComponent, resolveIcon, toJsxChildren } from '../scripts/iconify-lib.mjs'

// 2026-11-03 api.iconify.design 실제 응답에서 자른 본문(Phosphor, 256 격자)
const PH_CHECK = '<path fill="currentColor" d="m229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69L218.34 66.34a8 8 0 0 1 11.32 11.32"/>'
const LUCIDE_WALLET = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M19 7V4a1 1 0 0 0-1-1H5"/></g>'
const DUOTONE = '<g fill="currentColor"><path d="M216 64v144H40V64Z" opacity=".2"/><path d="M216 48H40"/></g>'

describe('Iconify 아이콘을 앱 아이콘으로 바꾸기(Phosphor 한 가족, D-048)', () => {
  it('한 색 채움 속성을 빼고 도형만 남긴다', () => {
    expect(toJsxChildren(PH_CHECK)).toBe('<path d="m229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69L218.34 66.34a8 8 0 0 1 11.32 11.32" />')
  })

  it('속성 없는 <g>는 벗기고, 남는 속성이 있는 <g>는 그대로 닫는다', () => {
    expect(toJsxChildren('<g fill="currentColor"><path d="M1 1h2"/><circle cx="4" cy="4" r="1"/></g>')).toBe('<path d="M1 1h2" /><circle cx="4" cy="4" r="1" />')
    expect(toJsxChildren('<g fill="currentColor" transform="rotate(45 128 128)"><path d="M1 1h2"/></g>'))
      .toBe('<g transform="rotate(45 128 128)"><path d="M1 1h2" /></g>')
  })

  it('선 아이콘(다른 가족), 두 톤의 반투명 층, 움직임 요소, 모르는 속성은 받지 않는다', () => {
    expect(() => toJsxChildren(LUCIDE_WALLET)).toThrow(/fill="none"/)
    expect(() => toJsxChildren(DUOTONE)).toThrow(/opacity/)
    expect(() => toJsxChildren('<g fill="currentColor"><animate attributeName="d"/></g>')).toThrow(/animate/)
    expect(() => toJsxChildren('<path fill="currentColor" onclick="x" d="M1 1"/>')).toThrow(/onclick/)
    expect(() => toJsxChildren('<path d="M1 1h2"/>')).toThrow(/채움/)
  })

  it('기념일 그림(fluent-emoji-flat)은 색 모드: #hex 채움과 fill-rule·clip-rule을 그대로 두고, 그 밖의 채움은 받지 않는다(D-049)', () => {
    expect(toJsxChildren('<g fill="none"><path fill="#fcd53f" d="M1 1h2"/><path fill="#ff6723" fill-rule="evenodd" d="M2 2" clip-rule="evenodd"/></g>', 'color'))
      .toBe('<g fill="none"><path fill="#fcd53f" d="M1 1h2" /><path fill="#ff6723" fillRule="evenodd" d="M2 2" clipRule="evenodd" /></g>')
    expect(() => toJsxChildren('<path fill="url(#a)" d="M1 1"/>', 'color')).toThrow(/#hex/)
    expect(() => toJsxChildren('<path fill="#fff" opacity=".5" d="M1 1"/>', 'color')).toThrow(/opacity/)
    expect(parseIconId('fluent-emoji-flat:birthday-cake')).toEqual({ prefix: 'fluent-emoji-flat', name: 'birthday-cake' })
    expect(renderComponent({ component: 'CakeArt', prefix: 'fluent-emoji-flat', name: 'birthday-cake', jsx: '<path d="M1 1" />' })).toContain('<svg {...emoji}>')
  })

  it('세트는 ph(앱 아이콘)와 fluent-emoji-flat(기념일 그림)만, ph 굵기는 보통·채움·작은 표시용 굵게만', () => {
    expect(parseIconId('ph:piggy-bank')).toEqual({ prefix: 'ph', name: 'piggy-bank' })
    expect(parseIconId('ph:heart-fill')).toEqual({ prefix: 'ph', name: 'heart-fill' })
    expect(parseIconId('ph:x-bold')).toEqual({ prefix: 'ph', name: 'x-bold' })
    expect(() => parseIconId('lucide:wallet')).toThrow(/쓰지 않는다/)
    expect(parseIconId('fluent-emoji-flat:heart-with-ribbon').name).toBe('heart-with-ribbon')
    expect(() => parseIconId('ph:heart-duotone')).toThrow(/굵기/)
    expect(() => parseIconId('ph:heart-thin')).toThrow(/굵기/)
    expect(() => parseIconId('wallet')).toThrow(/세트:이름/)
  })

  it('세트 라이선스가 고정해 둔 값(MIT)과 다르면 멈춘다', () => {
    expect(() => checkCollection('ph', { ph: { license: { spdx: 'MIT' }, height: 24 } })).not.toThrow()
    expect(() => checkCollection('ph', { ph: { license: { spdx: 'GPL-3.0' }, height: 24 } })).toThrow(/라이선스/)
  })

  it('응답에서 아이콘을 꺼내고, 없는 이름·256 아닌 격자·변형 별칭은 거절한다', () => {
    const json = { prefix: 'ph', width: 256, height: 256, icons: { check: { body: PH_CHECK } }, aliases: { tick: { parent: 'check' }, 'check-r': { parent: 'check', rotate: 1 } } }
    expect(resolveIcon(json, 'check')).toBe(PH_CHECK)
    expect(resolveIcon(json, 'tick')).toBe(PH_CHECK)
    expect(() => resolveIcon(json, 'check-r')).toThrow(/별칭/)
    expect(() => resolveIcon({ ...json, not_found: ['nope'] }, 'nope')).toThrow(/없다/)
    expect(() => resolveIcon({ ...json, width: 24, height: 24 }, 'check')).toThrow(/256×256/)
  })

  it('컴포넌트는 Icons.tsx의 Phosphor 공통 속성을 쓰고, CREDITS 줄은 라이선스 원문 위치를 적는다', () => {
    expect(componentName('cloud-sun')).toBe('CloudSunIcon')
    expect(componentName('calendar-blank-fill')).toBe('CalendarBlankFillIcon')
    const code = renderComponent({ component: 'CloudSunIcon', prefix: 'ph', name: 'cloud-sun', jsx: '<path d="M1 1" />' })
    expect(code).toContain('export const CloudSunIcon = () => <svg {...ph}><path d="M1 1" /></svg>')
    expect(creditRow({ component: 'CloudSunIcon', prefix: 'ph', name: 'cloud-sun', date: '2026-11-03' }))
      .toBe('| `CloudSunIcon` | Phosphor `cloud-sun` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |')
  })
})
