# Danawa Price Search

## What this skill does

다나와의 로그인 없는 공개 페이지 두 가지만 읽기 전용으로 읽어 상품 후보와 쇼핑몰별 가격을 보여 준다.

- 검색 페이지 `https://search.danawa.com/?query=…`: 상품 후보 40개까지, `pcode`, 상품명(용량 포함), 수량별 최저가(1개·2개 등), 단위 가격, 판매처 수
- 상품 페이지 `https://prod.danawa.com/info/?pcode=…`: 상품명, 평점·후기 수, "쇼핑몰별 최저가" 약 10줄(몰 이름·상품가·배송비), 다른 구성(수량별 최저가), 제조사·상표·원산지
- 구매·로그인·장바구니·찜은 하지 않는다.

이 사본은 원본과 달리 몰별 가격 AJAX(`prod.danawa.com/info/ajax/…`)를 부르지 않는다. 다나와 robots가 그 경로를 막았기 때문이다. 그래서 **카드 할인가·무이자 할부·결제조건 배지·전체 쇼핑몰 목록은 없다.** 상품 페이지에 그려져 오는 몰 줄만 쓴다. 다나와 바로가기(`/bridge/`) 링크도 부르지 않는다.

## When to use

- "다나와에서 에어팟 최저가 찾아줘"
- "이 상품 쇼핑몰별 가격 비교해줘"
- "무료배송인 곳 중에 어디가 제일 싸?"

## When not to use

- 실제 구매·로그인·회원 쿠폰이 필요한 경우
- 카드 할인·무이자 할부를 확정해야 하는 경우(이 사본은 읽지 않는다)
- 여러 상품을 한꺼번에 계속 모니터링하는 경우(10초 간격이라 맞지 않는다)

## Required inputs

상품명 또는 모델명. 넓으면 브랜드·용량·색상·모델을 먼저 묻는다.

> 찾을 다나와 상품명이나 모델명을 알려주세요. 예: 비비고 왕교자 1.05kg, 에어팟 프로 2세대 USB-C

## Commands

이 프로젝트 루트에서 실행한다. 파서는 앱 서버 함수와 같은 `supabase/functions/_shared/danawa.ts`를 쓰고 Node 23.6 이상이 필요하다(타입 제거).

```bash
node .claude/skills/danawa-price-search/scripts/danawa.mjs search "비비고 왕교자" --limit 5
node .claude/skills/danawa-price-search/scripts/danawa.mjs product 1234567
```

- 다나와 호출은 이 컴퓨터에서 **10초에 한 번**(검색·상품 페이지 합쳐서)이다. 스크립트가 알아서 기다리고 stderr에 몇 초 기다리는지 적는다. 기다림을 피하려고 스크립트를 거치지 않고 다나와를 직접 부르지 않는다.
- 후보를 고른 뒤 상품 페이지는 꼭 필요한 것만 연다(상품 하나에 10초).

## Output

`search`: `{source, source_url, checked_at, count, items[]}`. `items[]`는 `pcode`, `name`, `variants[]`(`qty` 수량, `price` 최저가, `unitPrice`·`unitLabel` 단위 가격, `mallCount` 판매처 수), `rating`, `reviewCount`, `imageUrl`, `url`.

`product`: `{source, source_url, checked_at, pcode, name, rating, reviewCount, pageQty, variants[], offers[], facts}`. `offers[]`는 `seller`, `price`, `delivery`(0 = 무료배송, null = 표시 없음), `total`(배송비를 알 때만 상품가+배송비)이고 `total`(없으면 `price`) 오름차순이다. `pageQty`는 몰 줄이 가리키는 수량("(N개)")이다.

페이지 구조가 바뀌어 읽지 못하면 `DanawaParseError`로 멈춘다. 빈 값이나 추정값을 내지 않는다.

## Response style

표로 답하고 표 아래에 출처와 조회 시각을 적는다.

```md
| 순위 | 판매처 | 상품가 | 배송비 | 합계 |
|---:|---|---:|---|---:|
| 1 | G마켓 | 21,900원 | 무료 | 21,900원 |
| 2 | 11번가 | 21,500원 | 3,000원 | 24,500원 |
| 3 | 롯데ON | 22,300원 | 표시 없음 | - |
출처: 다나와 상품 페이지(pcode 1234567) 쇼핑몰별 최저가, 2026-10-28 11:40 조회
```

- 배송비 `null`은 "표시 없음"으로 쓰고 무료로 바꾸지 않는다.
- 몰 줄의 가격은 상품 페이지가 가리키는 묶음(`pageQty`, 예: "1.05kg (3개)")의 가격이다. 표 제목에 그 수량을 적고, 1개 가격과 견줄 때는 `variants`의 `qty: 1` 값을 쓴다.
- 수량이 다른 구성(2개·3개 묶음)은 `variants`의 `qty`를 같이 적어 1개 가격과 섞지 않는다.
- 카드 할인·무이자는 "이 조회에서는 확인하지 않음"이라고 쓴다.
- 가격·배송비는 조회 시점 값이고 바뀔 수 있다고 짧게 덧붙인다.

## Workflow

1. 검색어를 확인한다.
2. `search`로 후보를 보고, 애매하면 상위 3~5개(상품명·용량·최저가·`pcode`)를 보여 주고 고르게 한다.
3. 고른 상품만 `product`로 몰별 가격을 읽는다.
4. 표와 출처·조회 시각으로 답한다.

## Failure modes

- 검색 결과 0개: 검색어를 좁히거나 바꾼다.
- `DanawaParseError`: 다나와 화면이 바뀐 것이다. 같은 파서를 쓰는 앱 장보기 탭도 깨졌을 수 있으니 사용자에게 알린다.
- 접근 차단·CAPTCHA가 나오면 우회하지 않고 실패로 알린다.

## Done when

- 상품 후보를 하나 이상 보였거나 못 찾은 까닭을 말했다.
- 고른 상품의 몰별 상품가·배송비를 출처·조회 시각과 함께 표로 보였다.
- robots가 막은 경로를 부르지 않았고 10초 간격을 지켰다.
