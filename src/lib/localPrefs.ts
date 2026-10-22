// 기기에 남기는 작은 기억(localStorage): 마지막으로 고른 '누구를 위한 지출' 등. 못 쓰는 환경이면 기본값만 쓴다.
import type { Lookup } from './lookup'
import type { Scope } from './types'

export function lsGet(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}
export function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v) } catch { /* 저장 공간을 못 쓰면 기본값만 사용 */ }
}

export function isScope(v: string | null): v is Scope {
  return v === 'shared' || v === 'husband' || v === 'wife' || v === 'child'
}

/** 마지막으로 고른 '누구를 위한' 값(사람마다 기억), 없으면 공동 */
export function defaultScope(lookup: Lookup): Scope {
  const last = lsGet(`ab:lastScope:${lookup.me}`)
  return isScope(last) ? last : 'shared'
}
