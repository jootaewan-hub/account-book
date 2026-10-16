import { describe, expect, it } from 'vitest'
import { lockScroll } from '../src/lib/scrollLock'

describe('시트 뒤 화면 스크롤 잠금', () => {
  it('시트 하나: 열면 잠그고 닫으면 원래대로', () => {
    const body = { overflow: '' }
    const release = lockScroll(body)
    expect(body.overflow).toBe('hidden')
    release()
    expect(body.overflow).toBe('')
  })

  it('닫히는 시트와 새 시트가 겹쳐도(기록하기 → 문자 붙여넣기 → 닫기) 마지막에 잠금이 남지 않는다', () => {
    const body = { overflow: '' }
    const entry = lockScroll(body)
    const smart = lockScroll(body)
    entry() // 기록하기 시트가 닫힘 애니메이션을 끝내고 빠진다
    expect(body.overflow).toBe('hidden') // 문자 입력 창은 아직 열려 있다
    smart()
    expect(body.overflow).toBe('')
  })

  it('먼저 연 시트가 나중에 닫혀도 원래대로', () => {
    const body = { overflow: '' }
    const a = lockScroll(body)
    const b = lockScroll(body)
    b()
    expect(body.overflow).toBe('hidden')
    a()
    expect(body.overflow).toBe('')
  })

  it('같은 해제를 두 번 불러도 다른 시트의 잠금은 풀지 않는다', () => {
    const body = { overflow: '' }
    const a = lockScroll(body)
    const b = lockScroll(body)
    a(); a()
    expect(body.overflow).toBe('hidden')
    b()
    expect(body.overflow).toBe('')
  })

  it('원래 값이 있었으면 그 값으로 돌린다', () => {
    const body = { overflow: 'auto' }
    lockScroll(body)()
    expect(body.overflow).toBe('auto')
  })
})
