# k-skill 사본: 출처와 바꾼 점

이 폴더의 스킬 14개는 [NomaDamas/k-skill](https://github.com/NomaDamas/k-skill) 커밋 `02081f8`(2026-10-26)에서 옮겼다. 라이선스는 MIT이고 원문은 `K-SKILL-LICENSE`다. 2026-10-28 사용자 요청("날씨·생활 기타·먹거리 주류·쇼핑·검색 파트에서 가계부에 적절한 것")으로 넣었다. 결정 기록은 `docs/grocery/tracking/decisions/index.md` D-034다.

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
| bccard-eatpl-search | 프록시 → BC카드 eat.pl (주소·업종·가맹점명), m.map.kakao.com (가맹점명) | 없음 | `npx … exec` → `node scripts/kakao-place-rating.mjs`, **프록시·실패 원인을 사용자에게 숨기라는 지시를 투명하게 고침**, 운영자 시크릿 설명 삭제, 없는 `kakao-map` 스킬 대신 프록시 curl |
| naver-news-search | 프록시 → 네이버 검색 API (검색어) | 없음(프록시 운영자 키) | 없음 |
| naver-blog-research | search.naver.com, m.blog.naver.com, 네이버 이미지 서버 (검색어·글 주소) | 없음 | `npx … exec` → `python3 -I scripts/…`, 이미지는 임시 폴더로, `--insecure` 금지 |
| coupang-product-search | 프록시 → 쿠팡 파트너스 API (검색어) | 없음 | `subId=k-skill` 삭제, 장바구니·구매·로그인(vault) 절 삭제, 링크가 파트너스 링크(구매 시 운영자 수수료)임을 알림 |
| naver-shopping-search | 프록시 → 네이버 쇼핑 (검색어) | 없음 | 없음 |
| ohou-today-deal | ohou.se 공개 페이지 (없음, 필터는 로컬) | 없음 | `npx … exec` → `python3 -I scripts/ohou_today_deal.py`, `--url` 금지 |
| delivery-tracking | cjlogistics.com, service.epost.go.kr (송장 번호) | 없음 | 송장 자릿수 확인, 보낸·받는 사람 이름을 답에 옮기지 않음 |
| daangn-used-goods-search | www.daangn.com (지역명·검색어) | 없음 | `npx … exec` → `python3 -I scripts/daangn_used_goods.py`, `detail`은 daangn.com 주소만 |

프록시 `k-skill-proxy.nomadamas.org`는 NomaDamas가 운영하는 제3자 서버다. 저장소의 프록시 코드는 요청 기록을 끄고 오류일 때만 쿼리 해시를 남기지만, 실제 배포본이 같은지는 확인 필요다.

## 넣지 않은 것 (같은 다섯 묶음)

| 스킬 | 까닭 |
|---|---|
| danawa-price-search | 다나와가 robots로 막은 `/info/ajax/`를 부르고 10초 간격이 없다(프로젝트 규칙 위반). 앱에 규칙을 지키는 `supabase/functions/_shared/danawa.ts`가 있다 |
| market-kurly-search | `data-sources.md`에 컬리 내부 API를 쓰지 않기로 적어 두었다. 대화 조회에도 그 결정을 적용할지는 사용자가 정한다(코드는 안전, 원하면 패키지 소스를 `scripts/`로 옮겨 넣을 수 있다) |
| daiso-product-search | 재고 조회가 다이소 JS 번들에 박힌 키로 토큰을 만든다(접근 통제 회색지대). 장보기와 관련도 낮다 |
| olive-young-search | 다른 작성자의 npm 패키지 `daiso`(hmmhmmhm/daiso-mcp)를 버전 고정 없이 실행해야 한다. 검토하지 않은 외부 코드 |
| bunjang-search | 외부 npm 패키지 `bunjang-cli`를 고정 없이 실행, 로그인 세션으로 찜·채팅(판매자에게 메시지)까지 한다 |
| consumer-price-safety-search | 초안(draft)이라 실행할 것이 없다 |
| daangn-cars-search, seoul-weather-risk, han-river-water-level, zipcode-search, public-restroom-nearby, donation-place-search, hankookilbo-news, geeknews-search | 가계부와 관련이 낮다(검토하지 않음) |
| kakaotalk-mac | 이 컴퓨터의 카카오톡 대화 기록을 읽는다 |
| hola-poke-yeoksam | 매장 한 곳의 광고 |
| heyyumi | 구글 로그인·식당 예약이 필요하다 |
| k-skill-setup, k-skill-cleaner | 자격 증명 수집·저장소 별 누르기 흐름, 스킬 정리 도구 |

장보기 회수 경고와 바로 이어지는 `mfds-food-safety`(건강·의료 묶음)는 다섯 묶음 밖이라 넣지 않았다. 원하면 같은 방식으로 검토해 넣는다.

## 확인한 것 (2026-10-28)

- 날씨: 서울시청 근처(37.57, 126.98) 단기예보 871건 응답.
- 공휴일: 2026년 공휴일 22일이 앱의 공휴일 표(`src/lib/holidays.ts`)와 날짜까지 같다.
- KAMIS: 그날 값이 없으면 `error_code` 001, `p_regday=2026-10-27`로 22품목 응답(당일·1일 전·1주 전·1년 전·평년). 분류 200(채소류)에 쌀이 먼저 나온 까닭은 확인 필요.
- 카카오 키워드 검색: 응답이 `documents[]`(`place_name`, `place_url`, `x`, `y` 등).
- 그 밖의 스킬은 실제로 부르지 않았다.

## 새 커밋으로 올리기

원본을 새 커밋으로 받아 바뀐 `instruction.md`·`scripts/`를 다시 읽은 뒤, `python3 -I scripts/k-skill-sync.py <원본 폴더>`로 다시 만든다. 바꿀 줄을 못 찾거나 원격 실행 말이 남으면 스크립트가 멈춘다. 이 파일의 커밋 번호와 표를 함께 고친다.
