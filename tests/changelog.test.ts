// 업데이트 내역(src/lib/changelog.ts): 버전 규칙(메이저 앞 숫자, 마이너 가운데, 버그 수정 끝)과 package.json이 맞는지.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LATEST, nextVersion, parseVersion, RELEASES, takeNewRelease } from '../src/lib/changelog'

describe('업데이트 내역', () => {
  it('최신이 맨 앞이고, 각 버전은 바로 앞 버전에서 그 종류만큼 올린 값이다', () => {
    const old = [...RELEASES].reverse()
    expect(old[0]).toMatchObject({ version: '1.0.0', kind: 'major' })
    for (let i = 1; i < old.length; i++) {
      expect(old[i].version, `${old[i - 1].version} 다음 ${old[i].kind}`).toBe(nextVersion(old[i - 1].version, old[i].kind))
      expect(old[i].date >= old[i - 1].date).toBe(true)
    }
  })

  it('형식: 버전 세 숫자, 날짜, 제목과 바뀐 점이 있고 화면 금지 문구가 없다', () => {
    for (const r of RELEASES) {
      expect(parseVersion(r.version)).not.toBeNull()
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.title.trim()).not.toBe('')
      expect(r.items.length).toBeGreaterThan(0)
      for (const t of [r.title, ...r.items]) for (const w of ['AI', '분석 중', '안전함']) expect(t).not.toContain(w)
    }
  })

  it('package.json version이 최신 릴리스와 같다(배포할 때 둘 다 올린다)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(pkg.version).toBe(LATEST.version)
  })

  it('다음 버전: 메이저는 앞 숫자, 마이너는 가운데, 버그 수정은 끝', () => {
    expect(nextVersion('2.6.0', 'major')).toBe('3.0.0')
    expect(nextVersion('2.6.3', 'minor')).toBe('2.7.0')
    expect(nextVersion('2.6.0', 'fix')).toBe('2.6.1')
  })

  it('새 버전 알림은 기기마다 한 번(전에 본 기록이 없어도 한 번)', () => {
    const mem = new Map<string, string>()
    const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => { mem.set(k, v) } }
    expect(takeNewRelease(store)).toBe(LATEST)
    expect(takeNewRelease(store)).toBeNull()
    mem.set('ab:seenRelease', '0.0.1')
    expect(takeNewRelease(store)).toBe(LATEST)
  })
})
