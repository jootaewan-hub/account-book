# 우리집 가계부 (+ 장보기)

부부 두 사람만 쓰는 가계부 PWA다. 2026-10-19부터 별도 저장소였던 '우리집 장보기'(jootaewan-hub/grocery-app)를 가계부 안의 '장보기' 탭으로 합쳤다(D-010, 설계 `docs/superpowers/specs/2026-10-19-grocery-integration-design.md`). 기능·구조·처음 설정은 `README.md`, 화면 규칙은 `DESIGN.md`에 있다.

## 공통

- 사용자와 문서는 한국어로 쓴다.
- 작업은 브랜치에서 한다. `main` 병합과 푸시는 사용자가 지시할 때만 한다. `main` 푸시는 곧 GitHub Pages 배포다.
- 공유 DB(Supabase `account-book`, ref `kifdfpbwiebfgvdumqjf`)에 마이그레이션을 적용하는 방법은 Supabase MCP의 `apply_migration` 하나뿐이고, 사용자 확인 뒤에만 한다. `supabase db push`는 쓰지 않는다.
- 새 마이그레이션 파일은 `supabase/migrations/`에서 이름이 가장 늦은 파일보다 뒤 시각으로 만든다. PGlite 테스트가 이름 순서로 적용한다.
- Edge Function 설정(`verify_jwt`)은 `supabase/config.toml`에 있다. 배포된 함수 설정과 같아야 한다.
- 사실이 불확실하면 "확인 필요"로 표시하고, 추측이면 "추측입니다"라고 먼저 밝힌다.
- UI를 바꾸면 `npm run screens`로 390·1280px, 라이트·다크를 캡처해 눈으로 확인한 뒤에 끝났다고 한다(사용법은 `scripts/screenshots.mjs` 맨 위).

## 장보기 부분

범위: `src/grocery/`, `tests/grocery/`, `supabase/migrations/*_grocery_*.sql`, Edge Function `food-alerts-sync`·`market-sync`·`tprice-sync`·`price-recheck`·`product-search`·`product-check`·`grocery-photo`·`food-info`·`_shared/`, `.github/workflows/`의 `food-alerts-sync`·`market-sync`·`tprice-sync`·`price-recheck` 워크플로, `docs/grocery/`.

장보기 일을 시작하기 전에 `docs/grocery/tracking/status.md`(현재 단계·열린 문제)와 `docs/grocery/tracking/decisions/index.md`(결정 기록, 이 저장소 전체의 결정 기록으로 쓴다)를 본다. 외부 데이터를 붙이기 전에는 `docs/grocery/data-sources.md`의 "확인된 사실"과 "확인 필요"를 본다. 화면 규칙의 장보기 확장분은 `docs/grocery/DESIGN.md`에 있다.

### 반드시 지킬 것 (장보기 부분)

- **화면의 숫자는 출처가 있는 값만 낸다.** 가격·시세·등락률·날짜는 API 응답이나 출처 페이지에 실제로 있는 값만 쓴다. 없으면 "확인 못 함"으로 둔다. 모델이 추정하거나 지어낸 숫자를 화면에 내지 않는다. 모든 가격·시세에는 출처와 기준일을 함께 표시한다.
- **"찾은 기록 없음"을 "안전함"으로 쓰지 않는다.** 회수·처분 기록이 검색되지 않았을 때는 "확인한 범위에서 찾은 기록 없음"과 확인한 출처를 적는다.
- **API 키는 서버에만 둔다.** 네이버·KAMIS·식품안전나라·공공데이터포털·Anthropic 키는 서버 함수의 환경변수로만 쓰고, 브라우저 번들이나 저장소에 넣지 않는다. `.env*`(단, `.env.example` 제외)는 커밋하지 않는다.
- **두 사람 외에는 아무것도 보이지 않는다.** 데이터는 가구(household) 단위로 묶고, DB 행 수준 보안(RLS)으로 그 가구 구성원만 읽고 쓰게 한다.
- **장보기 마이그레이션은 `grocery` 스키마만 바꾼다(D-003).** 가계부 `public` 표는 참조·읽기만 하고, 가계부 내역에 쓰는 것은 함수 하나로만 한다. `tests/grocery/boundary.test.ts`가 검사한다.
- **AI처럼 보이지 않게 만든다.** 화면에 "AI", 채팅창, 반짝이 아이콘, "분석 중…" 같은 말을 쓰지 않는다. 가격비교·가계부 앱처럼 숫자, 출처, 상태를 보여 준다. 진행 표시는 "가격 확인 중", "식약처 목록 확인 중"처럼 하는 일을 그대로 적는다.
- **UI 작업은 눈으로 확인한 뒤에 끝났다고 말한다.** 390px(휴대폰)과 1280px 화면을 라이트·다크 모두 캡처해 보고 고친다.
- **외부 호출은 한도를 지킨다.** 다나와 검색은 전역으로 10초에 한 번만 부른다(robots `Crawl-delay: 10`). robots가 막은 경로는 부르지 않는다. 같은 상품·같은 출처·같은 날은 캐시에서 돌려준다.
- **장보기 CSS는 `.grocery` 안에서만 먹는다.** `src/grocery/grocery.css`의 모든 선택자는 `.grocery`로 시작한다. 가계부 `styles.css`에서 장보기와 이름이 같은 클래스는 `:where(:not(.grocery *))`로 막는다(`tests/grocery/tokens.test.ts`).

### 문제를 만나면 (장보기 부분)

다음은 발견 즉시 사용자에게 알린다.

- 화면의 가격·시세가 출처 값과 다르거나, 출처·기준일 없이 표시되는 값을 발견했을 때.
- 회수·판매중지 대상 제품이 목록에 있는데 경고가 뜨지 않을 때.
- API 키가 브라우저 번들, 저장소, 로그에 노출된 것을 발견했을 때.
- 다른 사람이 가구 데이터를 읽을 수 있는 경로를 발견했을 때.

그 밖의 미해결 문제는 `docs/grocery/tracking/status.md`의 "열린 문제"에 무엇이 어떤 조건에서 관찰되는지와 함께 적는다.
