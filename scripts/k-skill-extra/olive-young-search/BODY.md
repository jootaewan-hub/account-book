# Olive Young Search

## What this skill does

올리브영 매장 검색, 상품 검색, 지역 매장 재고 표시를 조회한다. 조회만 한다.

**데이터 경로:** 원본은 다른 작성자(hmmhmmhm)의 npm 패키지 `daiso` CLI를 버전 고정 없이 실행했다. 그 CLI는 결국 그 작성자가 운영하는 공개 서버 `https://mcp.aka.page`에 GET을 보낼 뿐이라, 이 사본은 패키지를 받지 않고 같은 주소를 curl로 부른다.
- `mcp.aka.page`는 제3자 서버다. 검색어·지역과 이 컴퓨터의 IP를 본다.
- 원본 안내문에 따르면 그 서버는 올리브영 값을 Zyte(유료 수집 서비스)를 거쳐 가져온다. 올리브영 사이트는 일반 요청에 "잠시만 기다려 주세요" 봇 확인 화면을 준다(2026-10-28 확인). 즉 이 스킬의 값은 그 확인을 제3자가 넘어 가져온 것이다. 답할 때 출처 줄에 이 경로를 숨기지 않는다.
- 올리브영 사이트를 이 컴퓨터에서 직접 부르지 않는다.

## When to use

- "명동 올리브영에 선크림 재고 있어?"
- "올리브영에서 립밤 검색해줘"

## Required inputs

1. 지역·매장 키워드(예: 명동, 강남역, 성수)
2. 재고를 물으면 상품 키워드(예: 선크림, 립밤)

## Commands

```bash
BASE="https://mcp.aka.page"
curl -fsS --get "$BASE/api/oliveyoung/stores" --data-urlencode 'keyword=명동' --data-urlencode 'limit=5'
curl -fsS --get "$BASE/api/oliveyoung/products" --data-urlencode 'keyword=선크림' --data-urlencode 'size=5'
curl -fsS --get "$BASE/api/oliveyoung/inventory" --data-urlencode 'keyword=선크림' --data-urlencode 'storeKeyword=명동' --data-urlencode 'size=5'
```

응답은 `{success, data, meta}`다. 매장은 `data.stores[]`(`storeCode`, `storeName`, `address`, `pickupYn`), 재고는 `inventory.products[].storeInventory.stores[]`의 `storeName`, `stockLabel`, `remainQuantity`, `stockStatus`를 본다. 필드 이름은 실제 응답을 보고 맞춘다.

## Response style

- 기준 지역, 상위 매장 2~3곳, 상품 후보, 매장별 재고 표시(재고 있음·품절·미판매)
- 출처 줄: "올리브영 값(제3자 서버 mcp.aka.page 경유, 그 서버가 Zyte로 수집), <조회 시각> 조회". 실시간 보장값이 아니니 방문 전 다시 확인하라고 덧붙인다.

## Failure modes

- 그 서버가 5xx·503을 줄 수 있다(원본: 수집 경로 사정). 몇 번이고 다시 부르지 말고 실패를 알린다.
- 지역 키워드가 넓으면 멀리 있는 같은 이름 매장이 섞인다.

## Done when

- 매장 → 상품 → 재고 순서로 필요한 것만 불렀다.
- 매장별 재고 표시를 출처(제3자 서버 경유)·조회 시각과 함께 보였다.
