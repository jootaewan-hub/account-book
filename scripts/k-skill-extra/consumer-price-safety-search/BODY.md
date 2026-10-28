# 소비자 가격·리콜정보 조회

## What this skill does

- **리콜정보(스크립트)**: 소비자24(공정거래위원회)의 리콜정보 공개 화면을 키 없이 읽는다. 상품명·사업자명·모델명·인증번호로 찾고, 상세에서 위해 원인·소비자 행동요령·리콜 방법을 읽는다. 분류는 공산품, 식품, 건강기능식품, 축산물, 의약품, 의약외품, 의료기기, 화장품, 생활화학제품, 자동차, 먹는물, 위생용품, 생활방사선제품. 완구 같은 어린이 제품은 공산품에 있다(소비자24의 어린이용품 목록은 2026-10-28에 열리지 않아 뺐다).
- **가격정보(참가격)**: 이 사본에는 조회 스크립트가 없다. 아래 "가격을 물으면"을 따른다.

원본은 초안(draft)이라 실행할 것이 없었다. 이 사본의 리콜 조회는 이 프로젝트가 새로 썼다(소비자24 robots는 리콜정보 경로를 막지 않는다).

## When to use

- "이 가습기 리콜된 적 있어?"
- "요즘 장난감 리콜 뭐 있어?"
- "OO 회사 제품 리콜 내역 찾아줘"

## Commands

이 프로젝트 루트에서:

```bash
python3 -I .claude/skills/consumer-price-safety-search/scripts/consumer_recall.py categories
python3 -I .claude/skills/consumer-price-safety-search/scripts/consumer_recall.py search --keyword 가습기 --category 공산품 --limit 10
python3 -I .claude/skills/consumer-price-safety-search/scripts/consumer_recall.py search --keyword 만두 --category 식품,건강기능식품
python3 -I .claude/skills/consumer-price-safety-search/scripts/consumer_recall.py search --category 공산품 --from 2026-09-01 --to 2026-10-28
python3 -I .claude/skills/consumer-price-safety-search/scripts/consumer_recall.py detail RCLL_000000000596549 --category 공산품
```

- `--category`를 빼면 13개 분류를 1초 간격으로 모두 찾고 결과가 있는 분류만 보인다(13번 부른다). 분류를 알면 좁혀서 부른다.
- `detail`의 `--category`는 그 리콜이 나온 분류를 준다. `recallSn`은 `RCLL_숫자`만 받는다.

## Output

- `search`: `{source, checked_at, keyword, results[]}`. 분류마다 `total`(전체 건수)과 `items[]`(`recallSn`, `title`, `사업자명`, `리콜공표일`, `출처`, `주요판매처명`, `제조국가명`, `표준바코드` 등 화면 칸 그대로)
- `detail`: `productName`, `fields`(`모델명`, `리콜구분`, `리콜공표기간`, `위해원인 및 결과`, `위해정보`, `소비자 행동요령`, 리콜 방법, `기타 정보` 등 화면 칸 그대로), `page_url`

## Response style

- 찾은 리콜: 상품명·모델명, 사업자, 리콜 공표일, 출처 기관, 위해 원인 한 줄, 소비자 행동요령, 상세 링크(`page_url`)
- **찾은 기록이 없을 때 "안전하다"고 쓰지 않는다.** "소비자24 리콜정보(<분류>)에서 '<검색어>'로 찾은 기록 없음, <조회 시각> 기준"처럼 확인한 범위와 출처를 적는다(이 프로젝트 규칙).
- 식품 회수·판매중지는 식약처 목록에도 있다. 가계부 장보기 탭의 회수 경고가 그 목록을 쓴다. 이 스킬 결과로 장보기 탭의 값을 고치거나 DB에 넣지 않는다.

## 가격을 물으면 (참가격)

- 참가격 공식 API는 공공데이터포털 키가 필요하다. 이 프로젝트에서 그 키는 서버 함수 환경변수에만 두므로 이 스킬은 쓰지 않는다.
- 대신: 농·축·수산물 시세는 `kamis-food-price`, 온라인 가격은 `naver-shopping-search`·`danawa-price-search`, 가까운 매장의 참가격 값은 가계부 장보기 탭(참가격 성남 조사 매장)을 안내한다.
- 브라우저 도구가 있으면 참가격 공개 화면(`https://www.price.go.kr/tprice/portal/dailynecessitypriceinfo/priceiteminfo/getPriceItemInfoList.do`)을 열어 볼 수 있다. 이 경로는 아직 이 사본에서 확인하지 않았다(확인 필요). 연다면 화면에 보이는 값과 조사일만 쓴다.

## Failure modes

- "목록 모양을 읽지 못함"·"상세 모양을 읽지 못함": 소비자24 화면이 바뀐 것이다. 사실대로 말한다.
- 분류마다 건수가 크게 다르다(2026-10-28: 생활화학제품 7,152건, 공산품 4,474건, 축산물·먹는물 0건). 0건 분류는 "그 분류에 등록된 리콜이 없음"이지 다른 분류까지 없다는 뜻이 아니다.

## Done when

- 검색어·분류를 정했다.
- 찾은 리콜을 출처·조회 시각과 함께 보였거나, 확인한 범위를 적어 "찾은 기록 없음"이라고 말했다.
