import { describe, expect, it } from 'vitest'
import { inkOn, POPULAR, serviceOf, SERVICES } from '../src/lib/services'

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('구독 서비스 로고', () => {
  it('긴 이름을 먼저 맞춘다', () => {
    expect(serviceOf('유튜브 뮤직')?.name).toBe('유튜브 뮤직')
    expect(serviceOf('YouTube Premium 가족')?.name).toBe('유튜브 프리미엄')
    expect(serviceOf('쿠팡플레이')?.name).toBe('쿠팡플레이')
    expect(serviceOf('쿠팡 와우 멤버십')?.name).toBe('쿠팡 와우')
    expect(serviceOf('네이버웹툰 쿠키')?.name).toBe('네이버 웹툰')
    expect(serviceOf('Netflix')?.icon?.slug).toBe('netflix')
    expect(serviceOf('티빙')?.text).toBe('TVING')
    expect(serviceOf('동네 헬스장')).toBeNull()
  })

  it('빠른 선택 목록은 모두 있는 서비스이고, 로고 글자색은 바탕과 대비 3:1 이상', () => {
    expect(POPULAR.every(Boolean)).toBe(true)
    expect(inkOn('#ffcd00')).toBe('#111111') // 카카오 노랑에는 검은 글자
    expect(inkOn('#e50914')).toBe('#ffffff')
    const low = SERVICES.filter((s) => contrast(s.color, inkOn(s.color)) < 3).map((s) => s.name)
    expect(low).toEqual([])
  })
})
