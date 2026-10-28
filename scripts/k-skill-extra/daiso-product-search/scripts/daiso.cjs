// 이 프로젝트에서 다시 씀(D-034 보충): 다이소몰 공개 매장·상품 검색과 매장 픽업 가능 여부를 읽는다(parse.cjs는 원본 그대로).
// 원본의 매장 재고 수량 조회는 사이트 JS에 박힌 키로 비로그인 토큰을 암호화해 만든 Bearer로 불렀다.
// 다이소몰이 2026-05-05부터 재고 수량을 인증 뒤로 막았으므로 그 토큰 만들기와 재고 수량 호출은 옮기지 않았다(접근 통제 우회 금지).
// robots(User-agent *)는 /api/·/ssn/을 막지 않고 Crawl-delay 30을 둔다 → 이 컴퓨터의 다이소몰 호출은 30초에 한 번.
// 사용: node daiso.cjs stores "<매장명>" [--limit 5]
//       node daiso.cjs products "<상품명>" [--limit 10]
//       node daiso.cjs pickup <pdNo> --store "<매장명>" [--strcd <매장 코드>]
//       node daiso.cjs online <pdNo> [--onld <onldPdNo>]
const {
  BASE_API_URL,
  BASE_SEARCH_URL,
  buildSearchGoodsParams,
  normalizeOnlineStockResponse,
  normalizePickupEligibilityResponse,
  normalizeSearchGoodsResponse,
  normalizeStoreSearchResponse
} = require("./parse.cjs")
const { throttle } = require("./throttle.cjs")

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko,en-US;q=0.9,en;q=0.8",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
}

async function requestJson(url, body) {
  await throttle("daisomall", 30_000)
  const init = { method: body === undefined ? "GET" : "POST", headers: { ...HEADERS }, signal: AbortSignal.timeout(20_000) }
  if (body !== undefined) {
    init.headers["content-type"] = "application/json"
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  const payload = await res.json().catch(() => null)
  return { status: res.status, ok: res.ok, payload }
}

function option(args, name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}

const limitOf = (args, d) => Math.min(30, Math.max(1, Number(option(args, "--limit", d)) || d))

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2)
  const checkedAt = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T") + "+09:00"
  const out = (source, url, data) => console.log(JSON.stringify({ source, source_url: url, checked_at: checkedAt, ...data }, null, 2))

  if (cmd === "stores" && arg?.trim()) {
    const keyword = arg.trim()
    const url = `${BASE_API_URL}/ms/msg/selStr`
    const r = await requestJson(url, { keyword, pkupYn: "", currentPage: 1, pageSize: limitOf(rest, 5) })
    if (!r.ok) throw new Error(`다이소몰 매장 검색 ${r.status}`)
    return out("다이소몰 매장 검색", url, { query: keyword, items: normalizeStoreSearchResponse(r.payload, keyword) })
  }
  if (cmd === "products" && arg?.trim()) {
    const u = new URL(`${BASE_SEARCH_URL}/SearchGoods`)
    for (const [k, v] of Object.entries(buildSearchGoodsParams(arg, { limit: limitOf(rest, 10) }))) u.searchParams.set(k, String(v))
    const r = await requestJson(u.toString())
    if (!r.ok) throw new Error(`다이소몰 상품 검색 ${r.status}`)
    return out("다이소몰 상품 검색", u.toString(), normalizeSearchGoodsResponse(r.payload, arg.trim()))
  }
  if (cmd === "pickup" && /^[0-9A-Za-z]{1,20}$/.test(arg ?? "") && option(rest, "--store", "").trim()) {
    // 원본과 같이 매장명 끝의 "N호점"과 괄호를 떼어 픽업 가능 매장 목록을 찾는다
    const keyword = option(rest, "--store", "").replace(/\d+\s*호점\s*$/u, "").replace(/[(].*?[)]/gu, " ").replace(/\s+/gu, " ").trim()
    const strCd = option(rest, "--strcd", "")
    if (strCd && !/^\d{1,10}$/.test(strCd)) throw new Error("--strcd는 숫자만")
    const url = `${BASE_API_URL}/ms/msg/selPkupStr`
    const r = await requestJson(url, { pdNo: arg, keyword, currentPage: 1, pageSize: 50 })
    const { raw, ...result } = normalizePickupEligibilityResponse(r.payload || { success: false, message: `HTTP ${r.status}` }, { pdNo: arg, strCd, keyword, pageSize: 50 })
    return out("다이소몰 픽업 가능 매장", url, result)
  }
  if (cmd === "online" && /^[0-9A-Za-z]{1,20}$/.test(arg ?? "")) {
    const onld = option(rest, "--onld", arg)
    if (!/^[0-9A-Za-z_-]{1,30}$/.test(onld)) throw new Error("--onld는 숫자·영문만")
    const url = `${BASE_API_URL}/pdo/selOnlStck`
    const req = { pdNo: arg, onldPdNo: onld }
    const r = await requestJson(url, [req])
    if (!r.ok) throw new Error(`다이소몰 온라인 재고 ${r.status}`)
    return out("다이소몰 온라인 재고", url, normalizeOnlineStockResponse(r.payload, req))
  }
  process.stderr.write('사용: node daiso.cjs stores "<매장명>" | products "<상품명>" | pickup <pdNo> --store "<매장명>" [--strcd <코드>] | online <pdNo> [--onld <번호>]\n')
  process.exit(2)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
