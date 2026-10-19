// 예약 수집 함수(market-sync·tprice-sync)가 함께 쓰는 작은 도구. Deno와 Vitest가 함께 import한다.

const ERROR_MAX = 200
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 키(그대로·인코딩)를 가리고, 제어 문자를 빼고, ERROR_MAX자로 자른다. sync_runs.error는 로그인한 사용자가 읽는다. */
export function sanitize(text: string, apiKey: string): string {
  let out = text
  for (const form of [apiKey, apiKey.trim(), encodeURIComponent(apiKey.trim())]) {
    if (form) out = out.replace(new RegExp(escapeRe(form), 'gi'), '***')
  }
  return out.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, ERROR_MAX)
}

/** 한국 날짜 YYYY-MM-DD에서 n일 전 */
export function kstDate(now: Date, daysAgo = 0): string {
  return new Date(now.getTime() + 9 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10)
}
