// 단위 환산과 인분 계산. 화면에서만 쓴다.
import type { MeasuringTool, Origin } from './recipeContract.ts'

export const UNIT_ML: Record<string, number> = { 큰술: 15, T: 15, 작은술: 5, t: 5 }
export const SERVINGS_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8]

// 스푼은 계량스푼일 때만 ml로 바꾼다. 컵 등은 공식 출처를 찾기 전까지 붙이지 않는다.
export function unitMl(unit: string | null, tool: MeasuringTool): number | null {
  if (unit === null || tool !== '계량스푼') return null
  return Object.hasOwn(UNIT_ML, unit) ? UNIT_ML[unit] : null
}

type ServingsLike = { servings: { value: number | null; origin: Origin | null; suggested?: number | null } }

export function servingsBase(r: ServingsLike): { base: number; fromEditor: boolean } | null {
  const { value, suggested } = r.servings
  if (value != null) return { base: value, fromEditor: false }
  if (suggested != null) return { base: suggested, fromEditor: true }
  return null
}

const EXACT_UNITS = new Set(['g', 'ml', '그램', '밀리리터'])
const GLYPH = ['', '¼', '½', '¾']

export function scaleAmount(amount: number, unit: string | null, factor: number): string {
  const v = amount * factor
  if (unit !== null && EXACT_UNITS.has(unit.toLowerCase())) {
    const n = Math.round(v)
    return String(n < 1 && v > 0 ? 1 : n)
  }
  let q = Math.round(v * 4)
  if (q < 1 && v > 0) q = 1
  const whole = Math.floor(q / 4)
  const frac = GLYPH[q % 4]
  if (whole === 0) return frac || '0'
  return `${whole}${frac}`
}
