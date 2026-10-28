// 이 프로젝트에서 다시 씀(D-034 보충): 컬리 상품 페이지(www.kurly.com/goods/<번호>)의 __NEXT_DATA__에서 이름·가격·품절을 읽는다.
// 원본 패키지의 검색·개수 함수는 api.kurly.com을 부르는데 그 robots가 일반 봇을 모두 막아 옮기지 않았다(parse.cjs만 원본 그대로).
// www.kurly.com robots는 /goods/를 허용한다. 호출은 이 컴퓨터에서 2초에 한 번.
// 사용: node kurly.cjs detail <상품 번호 또는 https://www.kurly.com/goods/<번호> 주소>
const { extractNextDataJson, findProductDetail, buildGoodsUrl } = require("./parse.cjs")
const { throttle } = require("./throttle.cjs")

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36"

function productNoOf(arg) {
  const s = String(arg || "").trim()
  if (/^\d{4,12}$/.test(s)) return s
  let u
  try {
    u = new URL(s)
  } catch {
    return null
  }
  const m = u.pathname.match(/^\/goods\/(\d{4,12})\/?$/)
  return u.protocol === "https:" && u.hostname === "www.kurly.com" && m ? m[1] : null
}

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  const no = cmd === "detail" ? productNoOf(arg) : null
  if (!no) {
    process.stderr.write("사용: node kurly.cjs detail <상품 번호 | https://www.kurly.com/goods/<번호>>\n")
    process.exit(2)
  }
  const url = buildGoodsUrl(no)
  await throttle("kurly", 2_000)
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9", accept: "text/html" }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`컬리 ${res.status}: ${url}`)
  const { raw, ...detail } = findProductDetail(extractNextDataJson(await res.text()))
  console.log(JSON.stringify({ source: "컬리 상품 페이지", source_url: url, checked_at: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T") + "+09:00", ...detail }, null, 2))
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
