// 장보기 화면의 색 대비. 장보기 화면은 가계부 styles.css의 토큰 위에 src/grocery/grocery.css의 .grocery 값을 덮어 쓴다.
// 장보기 grocery-app의 tests/tokens.test.ts를 가계부 토큰 이름(--ink-2, --ink-3, --on-primary)으로 옮겼다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/grocery/lib/contrast'

const ledger = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
const grocery = readFileSync(new URL('../../src/grocery/grocery.css', import.meta.url), 'utf8')

/** text에서 start 뒤의 첫 { } 안의 --이름: #hex 를 읽는다 */
function readBlock(text: string, start: string): Record<string, string> {
  const at = text.indexOf(start)
  if (at < 0) throw new Error(`${start} 블록이 없다`)
  const open = text.indexOf('{', at)
  const close = text.indexOf('}', open)
  const out: Record<string, string> = {}
  for (const m of text.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toUpperCase()
  return out
}

const DARK = '@media (prefers-color-scheme: dark) {'

function tokens(theme: 'light' | 'dark'): Record<string, string> {
  const base = theme === 'light' ? readBlock(ledger, ':root {') : readBlock(ledger.slice(ledger.indexOf(DARK)), ':root {')
  const over = theme === 'light'
    ? readBlock(grocery, '.grocery { --ink-3')
    : readBlock(grocery.slice(grocery.indexOf(DARK)), '.grocery {')
  return { ...base, ...over }
}

describe('장보기 토큰', () => {
  it('contrastRatio 기준값', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#33312D', '#FFFFFF')).toBeCloseTo(12.98, 1)
  })
  it('라이트는 가계부 값, --ink-3만 장보기 값', () => {
    const t = tokens('light')
    expect(t['--canvas']).toBe('#FFFFFF'); expect(t['--oat']).toBe('#F4F1EC'); expect(t['--ink']).toBe('#33312D')
    expect(t['--clay']).toBe('#A8543E'); expect(t['--indigo']).toBe('#3D5A78')
    // 가계부 #77726A는 귀리 면 위 4.24:1이라 장보기 화면 안에서는 일부러 어둡게 둔다
    expect(readBlock(ledger, ':root {')['--ink-3']).toBe('#77726A')
    expect(t['--ink-3']).toBe('#726D65')
  })
  it('다크의 --ink-3은 가계부 다크 값과 같다(라이트 덮어쓰기가 다크에 남지 않는다)', () => {
    expect(tokens('dark')['--ink-3']).toBe(readBlock(ledger.slice(ledger.indexOf(DARK)), ':root {')['--ink-3'])
  })
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: 글자 토큰은 바탕과 묶음 면 위에서 4.5:1 이상`, () => {
      const t = tokens(theme)
      for (const fg of ['--ink', '--ink-2', '--ink-3', '--sage', '--clay', '--indigo', '--rose-ink'])
        for (const bg of ['--canvas', '--oat'])
          expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 주 버튼 글자(--on-primary on --ink) 4.5:1 이상`, () => {
      const t = tokens(theme)
      expect(contrastRatio(t['--on-primary'], t['--ink'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 배지·태그 글자 쌍 4.5:1 이상`, () => {
      const t = tokens(theme)
      const pairs = [['--clay', '--clay-soft'], ['--rose-ink', '--blush-soft'], ['--on-primary', '--clay'], ['--sage', '--sage-soft']]
      for (const [fg, bg] of pairs) expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('장보기 CSS는 .grocery 안에서만 먹는다', () => {
  it('모든 선택자가 .grocery로 시작한다', () => {
    const noComments = grocery.replace(/\/\*[\s\S]*?\*\//g, '')
    const heads = [...noComments.matchAll(/(^|[{}])\s*([^{}@\s][^{}]*?)\s*\{/g)].map((m) => m[2].trim())
      .filter((h) => !/^(from|to|\d+%)/.test(h)) // @keyframes 안
    expect(heads.length).toBeGreaterThan(100)
    for (const h of heads) for (const sel of h.split(',')) expect(sel.trim(), h).toMatch(/^\.grocery\b/)
  })
  it('가계부 CSS의 겹치는 클래스는 .grocery 안으로 들어오지 않는다', () => {
    const noComments = ledger.replace(/\/\*[\s\S]*?\*\//g, '')
    const bare = [...noComments.matchAll(/\.(seg|sheet|sheet-head|summary|tag|check|empty|who|who-husband|who-wife)(?![\w-])(?!:where\(:not\(\.grocery \*\)\))/g)]
    expect(bare.map((m) => m[0])).toEqual([])
  })
})
