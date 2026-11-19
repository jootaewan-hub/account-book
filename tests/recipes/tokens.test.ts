// 레시피 화면의 색 대비와 CSS 범위. 장보기 tests/grocery/tokens.test.ts와 같은 방식이다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/grocery/lib/contrast'

const ledger = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
const recipes = readFileSync(new URL('../../src/recipes/recipes.css', import.meta.url), 'utf8')

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
  const over = theme === 'light' ? readBlock(recipes, '.recipes { font-size') : readBlock(recipes.slice(recipes.indexOf(DARK)), '.recipes {')
  return { ...base, ...over }
}

describe('레시피 토큰', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: 글자 토큰은 바탕과 묶음 면 위에서 4.5:1 이상`, () => {
      const t = tokens(theme)
      for (const fg of ['--ink', '--ink-2', '--ink-3', '--clay'])
        for (const bg of ['--canvas', '--oat']) expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 눌린 칩·주 버튼 글자(--on-primary on --primary) 4.5:1 이상`, () => {
      const t = tokens(theme)
      expect(contrastRatio(t['--on-primary'], t['--primary'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 확인 표시(--clay on --clay-soft) 4.5:1 이상`, () => {
      const t = tokens(theme)
      expect(contrastRatio(t['--clay'], t['--clay-soft'])).toBeGreaterThanOrEqual(4.5)
    })
    it(`${theme}: 입력칸 테두리는 바탕과 3:1 이상이거나 가계부 선 토큰`, () => {
      const t = tokens(theme)
      if (theme === 'dark') expect(contrastRatio(t['--field-border'] ?? '#6E6960', t['--canvas'])).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('레시피 CSS는 .recipes 안에서만 먹는다', () => {
  it('모든 선택자가 .recipes로 시작한다', () => {
    const noComments = recipes.replace(/\/\*[\s\S]*?\*\//g, '')
    const heads = [...noComments.matchAll(/(^|[{}])\s*([^{}@\s][^{}]*?)\s*\{/g)].map((m) => m[2].trim()).filter((h) => !/^(from|to|\d+%)/.test(h))
    expect(heads.length).toBeGreaterThan(30)
    for (const h of heads) for (const sel of h.split(',')) expect(sel.trim(), h).toMatch(/^\.recipes\b/)
  })
  it('클래스 이름은 rcp-로 시작해 가계부 CSS의 클래스와 겹치지 않는다', () => {
    const names = [...recipes.matchAll(/\.(rcp-[\w-]+)/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(20)
    for (const n of new Set(names)) expect(ledger.includes(`.${n}`), n).toBe(false)
  })
})
