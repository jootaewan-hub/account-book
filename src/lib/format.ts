export function won(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

/** 달력 칸처럼 좁은 곳: 100만 이상은 '320만', 그 아래는 그대로 */
export function compact(n: number): string {
  return n >= 1_000_000 ? `${Math.round(n / 10_000)}만` : won(n)
}

export function parseAmount(s: string): number {
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
