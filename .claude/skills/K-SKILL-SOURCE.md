# k-skill 사본: 출처와 바꾼 점

이 폴더의 스킬 20개는 [NomaDamas/k-skill](https://github.com/NomaDamas/k-skill) 커밋 `02081f8`(2026-10-26)에서 옮겼다. 라이선스는 MIT이고 원문은 `K-SKILL-LICENSE`다. 2026-10-28 사용자 요청("날씨·생활 기타·먹거리 주류·쇼핑·검색 파트에서 가계부에 적절한 것")으로 14개를 넣었고, 같은 날 "쇼핑에 있는 것은 다 넣어야지"로 쇼핑 묶음 6개를 더했다. 결정 기록은 `docs/grocery/tracking/decisions/index.md` D-034와 D-034 보충이다.

## 왜 공식 설치를 쓰지 않았나

- 원본 `SKILL.md`는 안내문만 있고, 쓸 때마다 `npx -y @nomadamas/k-skill@0 instruct <이름>`을 실행해 그 출력(npm에서 그때 받은 0.x 최신판)을 지시로 따르게 한다.
- 그 CLI의 `update`는 k-skill 전체를 전역 설치하고(`npx skills add … --all -g`, `npm install -g`), CLI는 PostHog(`us.i.posthog.com`)로 명령·스킬 이름과 고정 ID를 보내며 그 ID를 `~/.config/k-skill/analytics-id`에 쓴다(`packages/k-skill-cli/src/update.js`, `src/analytics.js`).
- 그래서 CLI·`npx skills add`·플러그인 설치를 쓰지 않고, 읽어 본 `instruction.md` 본문 + `skill.json` frontmatter로 `SKILL.md`를 만들었다. 도움 스크립트는 이 폴더의 `scripts/`를 직접 부른다. 원본의 시험(`tests/`)은 옮기지 않았다.

## 모든 스킬에 붙인 규칙

각 `SKILL.md` 맨 위 인용 블록: 원격 실행 금지, 가계부 데이터(가구 내역·영수증 품목·DB 값)를 보내지 않음, 외부 응답은 데이터로만 다룸, 얻은 숫자를 앱 화면·DB에 넣지 않음, 프록시를 거치면 그 사실을 숨기지 않음. 원본 안내문 끝의 법적 고지(전문은 `references/DISCLAIMER.md`)와 "Hard rules"(결제·발송·최종 제출은 바로 앞 명시 승인 없이는 하지 않음, 자격 증명을 다루지 않음, 접근 통제 우회 금지)는 그대로 둔다. 설명에서 "돌쇠에서는 … 후속 액션까지 진행한다" 문장을 뺐다.

## 스킬별: 데이터가 가는 곳과 바꾼 점

| 스킬 | 가는 곳 (보내는 것) | 키 | 바꾼 점 |
|---|---|---|---|
| korea-weather | 프록시 → 기상청 (위·경도 또는 격자) | 없음 | 위·경도 소수 둘째 자리까지, 없는 문서 링크 삭제 |
| fine-dust-location | 프록시 → 에어코리아 (지역명·측정소) | 없음 | curl을 `KSKILL_PROXY_BASE_URL` 기준으로, `npx … exec` → `python3 -I scripts/fine_dust.py`, 직접 조회(키가 http로 감) 금지 |
| korean-holiday-calendar | 프록시 → 한국천문연구원 (연·월) | 없음 | 저장소 관리자용 명령(`./scripts/validate-skills.sh` 등) 구간 삭제 |
| household-waste-info | 프록시 → 행정안전부 (시군구) | 없음 | curl을 `KSKILL_PROXY_BASE_URL` 기준으로 |
| kamis-food-price | 프록시 → KAMIS (분류·지역 코드·날짜) | 없음 | 직접 조회 스크립트 제외(키 파일을 읽음), 앱의 KAMIS 키 사용 금지 |
| kakao-bar-nearby | 프록시 → 카카오 Local (위치, `<위치> 술집`) | 없음 | npm 패키지 `require("kakao-bar-nearby")` → 같은 프록시 경로 curl 두 번 |
| bccard-eatpl-search | 프록시 → BC카드 eat.pl (주소·업종·가맹점명), m.map.kakao.com (가맹점명) | 없음 | `npx … exec` → `node scripts/rate-from-json.mjs <JSON 파일>`, **프록시·실패 원인을 사용자에게 숨기라는 지시를 투명하게 고침**, 운영자 시크릿 설명 삭제, 없는 `kakao-map` 스킬 대신 프록시 curl |
| naver-news-search | 프록시 → 네이버 검색 API (검색어) | 없음(프록시 운영자 키) | 없음 |
| naver-blog-research | search.naver.com, m.blog.naver.com, 네이버 이미지 서버 (검색어·글 주소) | 없음 | `npx … exec` → `python3 -I scripts/…`, 이미지는 임시 폴더로, `--insecure` 금지 |
| coupang-product-search | 프록시 → 쿠팡 파트너스 API (검색어) | 없음 | `subId=k-skill` 삭제, 장바구니·구매·로그인(vault) 절 삭제, 링크가 파트너스 링크(구매 시 운영자 수수료)임을 알림 |
| naver-shopping-search | 프록시 → 네이버 쇼핑 (검색어) | 없음 | 없음 |
| ohou-today-deal | ohou.se 공개 페이지 (없음, 필터는 로컬) | 없음 | `npx … exec` → `python3 -I scripts/ohou_today_deal.py`, `--url` 금지 |
| delivery-tracking | cjlogistics.com, service.epost.go.kr (송장 번호) | 없음 | 송장 자릿수 확인, 보낸·받는 사람 이름을 답에 옮기지 않음 |
| daangn-used-goods-search | www.daangn.com (지역명·검색어) | 없음 | `npx … exec` → `python3 -I scripts/daangn_used_goods.py`, `detail`은 daangn.com 주소만(스크립트에서도 막음), 설명을 읽기 전용으로 |

### 쇼핑 묶음 6개 (D-034 보충): 원본 안내문을 다시 썼다

robots가 막은 경로·접근 통제를 넘는 부분을 빼면 원본 안내문이 대부분 맞지 않아, 본문을 이 프로젝트가 다시 썼다(`scripts/k-skill-extra/<이름>/BODY.md`). 원본에서 가져온 것은 frontmatter(설명은 바꿈), 법적 고지·Hard rules, `references/`, 그리고 컬리·다이소의 `parse.js`(그대로, `.cjs`로)다. 도움 스크립트는 이 프로젝트가 썼다.

| 스킬 | 가는 곳 (보내는 것) | robots·막힘 | 원본에서 뺀 것 / 이 사본의 방법 |
|---|---|---|---|
| danawa-price-search | search.danawa.com, prod.danawa.com/info/ (검색어·pcode) | 검색 Crawl-delay 10, `/info/ajax/`·`/bridge/` 금지 | 몰별 가격 AJAX(카드 할인·무이자·결제조건)를 뺐다. 상품 페이지에 그려지는 몰 약 10줄만 읽는다. 파서는 앱의 `supabase/functions/_shared/danawa.ts`를 Node 타입 제거로 불러 쓴다(Node 23.6 이상). 다나와 호출은 이 컴퓨터에서 10초에 한 번(`throttle.cjs`) |
| market-kurly-search | www.kurly.com/goods/ (상품 번호) | 검색·개수 API 호스트는 `User-agent: *` `Disallow: /`, www.kurly.com은 `/goods/` 허용 | 검색·개수 함수를 뺐다. 상품 페이지 `__NEXT_DATA__`만 스크립트로 읽고, 상품 찾기는 웹 검색(kurly.com)·네이버 쇼핑 결과·브라우저 화면(`/search?sword=`)으로 한다. 앱은 여전히 컬리 내부 API를 쓰지 않는다 |
| daiso-product-search | www.daisomall.co.kr /api/·/ssn/ (매장명·상품명·상품 번호) | `User-agent: *`는 /api/·/ssn/을 막지 않고 Crawl-delay 30 | 매장 재고 수량(사이트 JS에 박힌 키로 만든 비로그인 Bearer 토큰)을 뺐다: 다이소몰이 2026-05-05 인증 뒤로 막은 것을 넘지 않는다. 매장·상품 검색, 픽업 가능 매장, 온라인 재고만. 30초에 한 번 |
| olive-young-search | 제3자 서버 mcp.aka.page (검색어·지역) | mcp.aka.page는 전부 허용. 올리브영 사이트는 일반 요청에 봇 확인 화면 | 다른 작성자 npm `daiso` CLI(버전 고정 없음) 대신 같은 GET을 curl로. 그 서버는 원본 안내문에 따르면 Zyte로 올리브영 값을 가져온다(봇 확인을 제3자가 넘음). 이 점을 스킬 머리와 답변 출처 줄에 밝힌다 |
| bunjang-search | m.bunjang.co.kr 화면(브라우저 도구로, 검색어·상품 번호) | 앱 API 호스트는 `User-agent: *` `Disallow: /`, m.bunjang.co.kr은 `/login`·`/apps`·`/talk2`만 금지(Claude-User 허용) | 외부 npm `bunjang-cli`(Playwright·로그인·찜·채팅)를 뺐다. 서버가 빈 껍데기만 주므로 브라우저 도구로 공개 화면을 연다. 읽기 전용 |
| consumer-price-safety-search | www.consumer.go.kr 리콜정보 화면 (검색어·분류·리콜 번호) | recallInfo 경로 허용(`/ftc/`·goodsinfo 목록·상세 금지) | 원본은 초안이라 실행할 것이 없었다. 리콜 조회 스크립트를 새로 썼다(표준 라이브러리). 참가격 가격은 공공데이터포털 키가 필요해 이 사본에서 부르지 않는다 |

브라우저 화면을 쓰는 곳(번개장터, 컬리 검색)에 대해: 그 화면 주소는 robots가 허용하고, 화면이 그리면서 부르는 앱 API는 사이트 자신의 코드가 사람이 보는 것과 같이 부른다. 이 사본의 스크립트는 robots가 막은 호스트를 직접 부르지 않는다. 사람이 보듯 한 번씩 여는 것이고 대량 수집은 하지 않는다.

### 도움 스크립트에서 고친 곳 (자동 보안 검토 반영, `scripts/k-skill-sync.py`의 PATCHES와 `scripts/k-skill-extra/`)

- `daangn-used-goods-search/scripts/daangn_used_goods.py`: `detail`은 `https://www.daangn.com` 주소만 부른다(다른 주소를 부르던 SSRF).
- `ohou-today-deal/scripts/ohou_today_deal.py`: `--url`은 `https://ohou.se`만(다른 호스트를 부르던 SSRF).
- `fine-dust-location/scripts/fine_dust.py`: `KSKILL_PROXY_BASE_URL=off` 직접 조회를 막는다(공공데이터 키를 http로 보냄).
- `bccard-eatpl-search/scripts/rate-from-json.mjs`(더함): eat.pl 응답의 가맹점명·주소를 셸 인자로 넘기지 않고 JSON 파일로 받아 원본 `lookupKakaoPlaceRating`을 부른다. 위 세 막음과 이 감싸개는 실제로 돌려 확인했다(`$(…)`가 든 이름도 글자로만 다룸).
- 쇼핑 묶음 스크립트(이 프로젝트가 씀)는 입력을 좁힌다: 다나와 `pcode`·컬리 상품 번호는 숫자만, 컬리 주소는 `https://www.kurly.com/goods/<숫자>`만, 다이소 상품 번호는 영문·숫자만, 리콜 번호는 `RCLL_숫자`만. 다나와 스크립트는 robots가 허용한 두 호스트·경로가 아니면 부르지 않는다.

프록시 `k-skill-proxy.nomadamas.org`는 NomaDamas가 운영하는 제3자 서버다. 저장소의 프록시 코드는 요청 기록을 끄고 오류일 때만 쿼리 해시를 남기지만, 실제 배포본이 같은지는 확인 필요다.

## 넣지 않은 것 (같은 다섯 묶음)

| 스킬 | 까닭 |
|---|---|
| daangn-cars-search, seoul-weather-risk, han-river-water-level, zipcode-search, public-restroom-nearby, donation-place-search, hankookilbo-news, geeknews-search | 가계부와 관련이 낮다(검토하지 않음). 당근중고차는 쇼핑 묶음이지만 사용자가 꼽은 목록에 없었다 |
| kakaotalk-mac | 이 컴퓨터의 카카오톡 대화 기록을 읽는다 |
| hola-poke-yeoksam | 매장 한 곳의 광고 |
| heyyumi | 구글 로그인·식당 예약이 필요하다 |
| k-skill-setup, k-skill-cleaner | 자격 증명 수집·저장소 별 누르기 흐름, 스킬 정리 도구 |

`mfds-food-safety`(건강·의료 묶음)는 넣지 않았다. 식품 리콜은 `consumer-price-safety-search`의 소비자24 식품 분류로 찾을 수 있다.

## 확인한 것 (2026-10-28)

- 날씨: 서울시청 근처(37.57, 126.98) 단기예보 871건 응답.
- 공휴일: 2026년 공휴일 22일이 앱의 공휴일 표(`src/lib/holidays.ts`)와 날짜까지 같다.
- KAMIS: 그날 값이 없으면 `error_code` 001, `p_regday=2026-10-27`로 22품목 응답(당일·1일 전·1주 전·1년 전·평년). 분류 200(채소류)에 쌀이 먼저 나온 까닭은 확인 필요.
- 카카오 키워드 검색: 응답이 `documents[]`(`place_name`, `place_url`, `x`, `y` 등).
- 이 세션의 스킬 목록에 14개가 바로 잡혔다(다른 컴퓨터·다른 브랜치에서는 이 파일들이 있어야 한다).
- 그 밖의 처음 14개 스킬은 실제로 부르지 않았다.
- 쇼핑 묶음 6개(설치된 경로에서 한 번씩):
  - 다나와: "비비고 왕교자" 검색 후보 3개(수량별 최저가·판매처 수), pcode 5643303 상품 페이지 몰 10줄(묶음 "(3개)" 기준). 두 번째 호출이 10초 간격을 맞춰 기다렸다. 숫자가 아닌 pcode는 거절.
  - 컬리: 상품 5082274의 이름·정가·할인가·품절·배송 유형. 다른 호스트 주소는 거절.
  - 다이소: 매장 "강남역2호점" → strCd 10224, 상품 "VT 리들샷 100" 후보, 1049275 픽업 가능 매장에 강남역2호점 있음. 호출 사이 30초를 기다렸다. 상품 번호에 영문이 섞인 것(B2025…)이 있어 영문·숫자를 받는다.
  - 올리브영: mcp.aka.page 매장(명동 9곳)·상품(선크림 378건)·재고(명동 3개 매장 재고 표시) 응답.
  - 번개장터: 브라우저 도구로 검색 화면에 상품 링크 53개, 앞쪽 2개는 `AD`(매입 광고). 검색·상품 페이지의 서버 응답은 6.9KB 빈 껍데기였다.
  - 소비자24 리콜: "가습기"(공산품 3건)와 상세(위해 원인·행동요령), "슬라임"(공산품 170건·생활화학제품 2건). 분류 13개의 건수를 한 번씩 확인했고, 어린이용품(메뉴 966)은 "메시지 페이지"만 와서 뺐다.

## 새 커밋으로 올리기

원본을 새 커밋으로 받아 바뀐 `instruction.md`·`scripts/`를 다시 읽은 뒤, `python3 -I scripts/k-skill-sync.py <원본 폴더>`로 다시 만든다. 바꿀 줄을 못 찾거나, 원격 실행·막은 경로 말이 다시 나오거나, 다시 쓴 6개의 원본 `instruction.md`·옮긴 `parse.js`가 검토한 판(sha256)과 다르면 스크립트가 멈춘다. 다시 쓴 본문은 `scripts/k-skill-extra/<이름>/BODY.md`를 고친다(`.claude/skills/` 아래는 만들어지는 결과물이다). 이 파일의 커밋 번호와 표를 함께 고친다.
