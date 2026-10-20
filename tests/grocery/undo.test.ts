// 빼기 되돌리기 묶음(D-017): 연달아 뺀 묶음을 쌓아 "N개 뺐어요"로 보여 주고, 되돌리기는 마지막 묶음부터 하나씩.
import { describe, expect, it } from 'vitest'
import { dropId, popGroup, pushGroup, removedText } from '../../src/grocery/lib/undo'

describe('빼기 되돌리기 묶음', () => {
  it('연달아 뺀 묶음을 쌓고, 되돌리기는 마지막 묶음부터', () => {
    let s = pushGroup([], { ids: ['a'], what: '삼겹살을' })
    s = pushGroup(s, { ids: ['b', 'c'], what: '채소 2개를' })
    expect(removedText(s)).toBe('3개 뺐어요.')
    const p = popGroup(s)
    expect(p.group).toEqual({ ids: ['b', 'c'], what: '채소 2개를' })
    expect(removedText(p.rest)).toBe('삼겹살을 뺐어요.')
    expect(popGroup(p.rest)).toEqual({ rest: [], group: { ids: ['a'], what: '삼겹살을' } })
    expect(popGroup([])).toEqual({ rest: [], group: null })
  })
  it('한 묶음만 있으면 전처럼 이름으로 말한다', () => {
    expect(removedText([{ ids: ['x', 'y'], what: '채소 2개를' }])).toBe('채소 2개를 뺐어요.')
    expect(removedText([])).toBe('')
  })
  it('지워진 품목은 묶음에서 빠지고 빈 묶음은 사라진다', () => {
    const s = [{ ids: ['a'], what: '삼겹살을' }, { ids: ['b', 'c'], what: '채소 2개를' }]
    expect(dropId(s, 'a')).toEqual([{ ids: ['b', 'c'], what: '채소 2개를' }])
    expect(dropId(s, 'b')).toEqual([{ ids: ['a'], what: '삼겹살을' }, { ids: ['c'], what: '채소 2개를' }])
    expect(dropId(s, 'zzz')).toEqual(s)
  })
})
