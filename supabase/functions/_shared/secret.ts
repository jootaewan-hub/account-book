// 비밀 값 비교. 환경변수를 읽지 않는 순수 함수라 Node(시험)와 Deno 양쪽에서 쓴다.
// 양쪽을 SHA-256으로 길이를 맞춘 뒤 바이트를 끝까지 비교해 길이·내용으로 시간 차가 나지 않게 한다.
export async function secretMatches(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected || provided.length > 512) return false
  const encode = new TextEncoder()
  const [a, b] = await Promise.all([provided, expected].map(async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(v)))))
  return a.reduce((diff, byte, i) => diff | (byte ^ b[i]), 0) === 0
}
