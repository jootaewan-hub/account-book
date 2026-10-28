// 이 프로젝트에서 더함(D-034): eat.pl 응답에서 온 가맹점명·주소를 셸 인자로 넘기지 않으려고 JSON 파일로 받는다.
// 사용: node rate-from-json.mjs <파일>  (파일: [{"name": "가맹점명", "address": "주소"}, …])
import { readFileSync } from "node:fs";
import { DEFAULT_PROXY_BASE_URL, lookupKakaoPlaceRating } from "./kakao-place-rating.mjs";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: rate-from-json.mjs <json 파일>\n");
  process.exit(2);
}
const rows = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(rows)) {
  process.stderr.write("JSON은 [{name, address}, …] 배열이어야 한다\n");
  process.exit(2);
}
const proxyBaseUrl = process.env.KSKILL_PROXY_BASE_URL || DEFAULT_PROXY_BASE_URL;
for (const row of rows) {
  const result = await lookupKakaoPlaceRating({ name: String(row?.name ?? ""), address: String(row?.address ?? ""), proxyBaseUrl });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
