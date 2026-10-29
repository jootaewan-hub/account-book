import { describe, expect, it } from 'vitest'
import { firstLine, matchNotes, normalizeNote, noteByline, noteWhen, sortNotes, type Note } from '../src/lib/notes'

const base: Note = {
  id: 'a', title: '관리사무소', body: '031-000-0000', pinned: false,
  created_by: 'me', updated_by: 'me', created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z',
}
const label = (id: string) => (id === 'me' ? '남편' : id === 'you' ? '아내' : 'Kim')

describe('함께 기억할 것 계산', () => {
  it('제목·내용을 다듬고 빈 내용은 없음으로, 비거나 긴 제목은 막는다', () => {
    expect(normalizeNote({ title: '  필터  ', body: '  \n ', pinned: true })).toEqual({ title: '필터', body: null, pinned: true })
    expect(normalizeNote({ title: '필터', body: '\n석 달마다\n', pinned: false }).body).toBe('석 달마다')
    expect(() => normalizeNote({ title: '   ', body: null, pinned: false })).toThrow('제목')
    expect(() => normalizeNote({ title: '가'.repeat(61), body: null, pinned: false })).toThrow('60자')
    expect(() => normalizeNote({ title: '필터', body: '가'.repeat(2001), pinned: false })).toThrow('2,000자')
  })

  it('고정한 것 먼저, 그 안에서는 최근에 고친 것 먼저', () => {
    const rows = [
      { ...base, id: 'old' },
      { ...base, id: 'new', updated_at: '2026-10-28T01:00:00Z' },
      { ...base, id: 'pin', pinned: true, updated_at: '2026-10-01T01:00:00Z' },
    ]
    expect(sortNotes(rows).map((n) => n.id)).toEqual(['pin', 'new', 'old'])
  })

  it('띄어 쓴 말이 제목·내용에 모두 있어야 찾는다(대소문자 무시)', () => {
    const rows = [{ ...base }, { ...base, id: 'b', title: '와이파이', body: '이름 Home_5G' }]
    expect(matchNotes(rows, '  ').map((n) => n.id)).toEqual(['a', 'b'])
    expect(matchNotes(rows, 'home 와이').map((n) => n.id)).toEqual(['b'])
    expect(matchNotes(rows, '031 와이')).toEqual([])
  })

  it('달력 묶음에는 내용의 첫 글줄', () => {
    expect(firstLine('\n  \n 평일 9~6시 \n주말 휴무')).toBe('평일 9~6시')
    expect(firstLine(null)).toBe('')
  })

  it('날짜는 오늘·어제·같은 해·다른 해로 쓴다', () => {
    const now = new Date(2026, 9, 29, 12)
    expect(noteWhen(new Date(2026, 9, 29, 0, 5).toISOString(), now)).toBe('오늘')
    expect(noteWhen(new Date(2026, 9, 28, 23).toISOString(), now)).toBe('어제')
    expect(noteWhen(new Date(2026, 2, 2).toISOString(), now)).toBe('3월 2일')
    expect(noteWhen(new Date(2025, 2, 2).toISOString(), now)).toBe('2025년 3월 2일')
  })

  it('고친 적이 없으면 적은 사람, 고쳤으면 고친 사람을 쓰고 조사를 맞춘다', () => {
    const now = new Date(2026, 9, 29, 12)
    expect(noteByline({ ...base, created_at: new Date(2026, 2, 2).toISOString(), updated_at: new Date(2026, 2, 2).toISOString() }, label, now)).toBe('3월 2일 남편이 적음')
    expect(noteByline({ ...base, updated_by: 'you', updated_at: new Date(2026, 9, 28).toISOString() }, label, now)).toBe('어제 아내가 고침')
    expect(noteByline({ ...base, created_by: 'x', updated_by: 'x', updated_at: new Date(2026, 9, 29, 9).toISOString() }, label, now)).toBe('오늘 Kim이(가) 고침')
  })
})
