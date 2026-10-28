// PostgREST의 서버 행 제한보다 요청 크기가 커도 전체 결과를 읽는다. 브라우저·Edge Function 공용.
type Page<T> = { data: T[] | null; error: { message: string } | null; count?: number | null }

export async function readAllPages<T>(
  load: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = []
  let total: number | null = null
  for (;;) {
    const page = await load(rows.length, rows.length + 499)
    if (page.error) throw new Error(page.error.message)
    if (!page.data) throw new Error('내역을 모두 불러오지 못했어요. 다시 시도해 주세요.')
    if (total === null && page.count != null) total = page.count
    if (page.data.length === 0) {
      if (total !== null && rows.length < total) throw new Error('조회 중 내역이 바뀌었어요. 다시 시도해 주세요.')
      return rows
    }
    rows.push(...page.data)
    if (total !== null && rows.length >= total) return rows
    // 받은 수만큼 이동한다. 요청한 500행보다 적어도 끝이라고 판단하지 않는다.
  }
}
