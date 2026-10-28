# Daiso Product Search

## What this skill does

다이소몰 공개 표면으로 매장과 상품을 찾고, 그 상품을 어느 매장에서 픽업할 수 있는지 확인한다. 조회만 한다.

- 매장 검색: 매장명 → 매장 코드(`strCd`)·주소
- 상품 검색: 상품명 → 상품 번호(`pdNo`)·가격·픽업 가능 표시
- 픽업 가능 매장: 상품 번호 + 지역·매장명 → 그 상품을 픽업할 수 있는 매장 목록과 고른 매장이 들어 있는지
- 온라인 재고(참고): 다이소몰 온라인 재고

**매장별 재고 수량은 확인하지 않는다.** 다이소몰이 2026-05-05부터 매장 재고 수량을 인증 뒤로 막았다. 원본은 사이트 JS에 박힌 키로 토큰을 만들어 그 막힘을 넘었는데, 이 사본은 접근 통제를 넘지 않으려고 그 부분을 옮기지 않았다. 매장 안 진열 위치도 공식 표면에 없다.

## When to use

- "강남역2호점에 VT 리들샷 있어?" (픽업 가능 여부로 답한다)
- "다이소에서 이 상품 얼마야?"

## Required inputs

1. 매장명(예: 강남역2호점). 없으면 먼저 묻는다.
2. 상품명(예: VT 리들샷 100). 넓으면 브랜드·용량을 묻는다.

## Commands

이 프로젝트 루트에서. 다이소몰 robots(`User-agent: *`)의 Crawl-delay 30을 지켜 **이 컴퓨터의 다이소몰 호출은 30초에 한 번**이다. 한 번 확인에 보통 세 번 부르므로 1분 넘게 걸린다고 먼저 말한다.

```bash
node .claude/skills/daiso-product-search/scripts/daiso.cjs stores "강남역2호점" --limit 5
node .claude/skills/daiso-product-search/scripts/daiso.cjs products "VT 리들샷 100" --limit 10
node .claude/skills/daiso-product-search/scripts/daiso.cjs pickup 1049275 --store "강남역2호점" --strcd 10224
node .claude/skills/daiso-product-search/scripts/daiso.cjs online 1049275
```

- `pickup`은 매장명 끝의 "N호점"과 괄호를 떼어 지역 이름으로 픽업 가능 매장을 찾고, `--strcd`를 주면 그 매장이 목록에 있는지(`matchedStore`, `pickupEligible`)를 본다.
- 스크립트를 거치지 않고 다이소몰을 직접 부르지 않는다. 검색어 파라미터가 틀려도 200으로 전체 목록이 와서 실패가 성공처럼 보인다(원본 경고).

## Output

모두 `{source, source_url, checked_at, …}`.
- `stores`: `items[]`(`strCd`, `name`, 주소 등)
- `products`: 상품 후보(`pdNo`, `onldPdNo`, 이름, 가격, `pickupAvailable` 등)
- `pickup`: `pickupEligible`(true/false/null), `eligibleStoreCount`, `eligibleStores[]`, `matchedStore`, `retrievalStatus`
- `online`: 온라인 재고 참고값

## Response style

- 매장명, 상품명·가격, 픽업 가능 여부("이 매장은 픽업 가능 매장 목록에 있음/없음"), 필요하면 온라인 재고 참고값
- "매장 재고 수량은 다이소몰이 공개하지 않아 확인하지 않았다", "방문 전 매장에 다시 확인"을 덧붙인다.
- 출처 줄: "다이소몰 공개 검색, <조회 시각> 조회"

## Failure modes

- 매장명이 넓으면 여러 지점이 잡힌다: 2~3개를 보여 주고 고르게 한다.
- `pickup`의 `retrievalStatus`가 `blocked`면 다이소몰이 거절한 것이다. 우회하지 않고 사실대로 말한다.

## Done when

- 매장과 상품을 확정했다.
- 픽업 가능 여부(또는 확인 못 한 까닭)를 출처·조회 시각과 함께 말했다.
- 재고 수량을 지어내지 않았고 30초 간격을 지켰다.
