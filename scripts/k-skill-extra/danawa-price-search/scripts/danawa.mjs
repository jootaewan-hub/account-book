// 이 프로젝트에서 다시 씀(D-034 보충): 다나와 검색 결과와 상품 페이지를 읽는다. 파서는 앱 서버 함수가 쓰는 것
// (supabase/functions/_shared/danawa.ts, tests/grocery/danawa.test.ts가 지킨다)을 Node 타입 제거로 불러온다(Node 23.6 이상).
// robots: search.danawa.com은 Crawl-delay 10, prod.danawa.com은 /info/만 허용(/info/ajax/·/bridge/ 금지).
// 그래서 검색 페이지와 상품 페이지 /info/?pcode= 두 가지만 부르고, 이 컴퓨터의 다나와 호출은 두 호스트를 합쳐 10초에 한 번이다.
// 사용: node danawa.mjs search "<검색어>" [--limit 10]
//       node danawa.mjs product <pcode>
import { throttle } from "./throttle.cjs"
import { danawaProductUrl, danawaSearchUrl, parseDanawaProduct, parseDanawaSearch } from "../../../../supabase/functions/_shared/danawa.ts"

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"

async function fetchHtml(url) {
  const { hostname, pathname } = new URL(url)
  if (!["search.danawa.com", "prod.danawa.com"].includes(hostname) || (hostname === "prod.danawa.com" && !pathname.startsWith("/info/")) || pathname.startsWith("/info/ajax/")) {
    throw new Error(`robots가 허용한 다나와 경로가 아니다: ${url}`)
  }
  await throttle("danawa", 10_000)
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  if (!res.ok) throw new Error(`다나와 ${res.status}: ${url}`)
  return text
}

function usage() {
  process.stderr.write('사용: node danawa.mjs search "<검색어>" [--limit 10] | node danawa.mjs product <pcode>\n')
  process.exit(2)
}

const [cmd, arg, ...rest] = process.argv.slice(2)
const checkedAt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T") + "+09:00"
if (cmd === "search" && arg?.trim()) {
  const i = rest.indexOf("--limit")
  const limit = i >= 0 ? Math.min(40, Math.max(1, Number(rest[i + 1]) || 10)) : 10
  const url = danawaSearchUrl(arg.trim())
  const items = parseDanawaSearch(await fetchHtml(url)).slice(0, limit)
  console.log(JSON.stringify({ source: "다나와 검색", source_url: url, checked_at: checkedAt, count: items.length, items: items.map((it) => ({ ...it, url: danawaProductUrl(it.pcode) })) }, null, 2))
} else if (cmd === "product" && /^\d{4,12}$/.test(arg ?? "")) {
  const url = danawaProductUrl(arg)
  const p = parseDanawaProduct(await fetchHtml(url), arg)
  // 쇼핑몰별 줄은 상품 페이지에 그려져 오는 것만(약 10줄). 배송비 null은 "표시 없음"이지 무료가 아니다
  const offers = p.offers.map((o) => ({ ...o, total: o.delivery == null ? null : o.price + o.delivery })).sort((a, b) => (a.total ?? a.price) - (b.total ?? b.price))
  console.log(JSON.stringify({ source: "다나와 상품 페이지", source_url: url, checked_at: checkedAt, ...p, offers }, null, 2))
} else {
  usage()
}
