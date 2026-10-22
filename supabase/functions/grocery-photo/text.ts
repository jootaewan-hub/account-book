// 사진 읽기 결과를 글로 바꾸는 순수 함수. 브라우저(담기 시트·후보 시트)와 서버 함수가 함께 쓴다.
// photo.ts와 달리 zod 스키마·프롬프트가 없어, 브라우저 번들에 서버 지시문과 zod가 딸려 들어가지 않는다.

/** 포장에서 읽은 값(photo.ts ProductSchema와 같은 모양. note는 검색어에 쓰지 않는다) */
export type ProductText = { name: string | null; brand: string | null; size: string | null; note?: string | null }
/** 살 것 한 줄 */
export type ListItem = { name: string; spec: string | null; count: number }

/** 다나와 검색어: 브랜드 + 이름 + 용량. 이름에 이미 든 말은 다시 붙이지 않는다. */
export function productQuery(r: ProductText): string {
  const parts: string[] = []
  const has = (s: string) => parts.some((p) => p.includes(s)) || (r.name ?? '').includes(s)
  if (r.brand && !has(r.brand)) parts.push(r.brand)
  if (r.name) parts.push(r.name)
  if (r.size && !has(r.size)) parts.push(r.size)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** 담기 시트의 글로: 한 줄에 하나, "이름 규격 N개"(담기 시트의 나누기 규칙과 맞춤) */
export function listText(items: ListItem[]): string {
  return items.map((it) => [it.name, it.spec, it.count > 1 ? `${it.count}개` : null].filter(Boolean).join(' ')).join('\n')
}
