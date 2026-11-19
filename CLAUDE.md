# 우리집 가계부 (+ 장보기)

부부 두 사람만 쓰는 가계부 PWA다. 2026-10-19부터 별도 저장소였던 '우리집 장보기'(jootaewan-hub/grocery-app)를 가계부 안의 '장보기' 탭으로 합쳤다(D-010, 설계 `docs/superpowers/specs/2026-10-19-grocery-integration-design.md`). 기능·구조·처음 설정은 `README.md`, 화면 규칙은 `DESIGN.md`에 있다.

## 공통

- 사용자와 문서는 한국어로 쓴다.
- 작업은 브랜치에서 한다. `main` 병합과 푸시는 사용자가 지시할 때만 한다. `main` 푸시는 곧 GitHub Pages 배포다.
- 공유 DB(Supabase `account-book`, ref `kifdfpbwiebfgvdumqjf`)에 마이그레이션을 적용하는 방법은 Supabase MCP의 `apply_migration` 하나뿐이고, 사용자 확인 뒤에만 한다. `supabase db push`는 쓰지 않는다.
- 새 마이그레이션 파일은 `supabase/migrations/`에서 이름이 가장 늦은 파일보다 뒤 시각으로 만든다. PGlite 테스트가 이름 순서로 적용한다.
- Edge Function 설정(`verify_jwt`)은 `supabase/config.toml`에 있다. 배포된 함수 설정과 같아야 한다.
- 사실이 불확실하면 "확인 필요"로 표시하고, 추측이면 "추측입니다"라고 먼저 밝힌다.
- main에 올리는 변경은 버전을 매겨 `src/lib/changelog.ts` 맨 위에 업데이트 내역(사용자가 읽는 말)을 더하고 `package.json` version도 같게 바꾼다(D-028). 메이저(쓰임새가 크게 바뀜)는 앞 숫자 v1 → v2 → v3, 마이너(기능 추가·기본 동작 바뀜)는 가운데 숫자 v2.6.0 → v2.7.0, 단순 버그 수정은 끝 숫자 v2.6.0 → v2.6.1. 배포를 마치면 그 릴리스의 내용을 사용자에게 정리해 보여 준다.
- 밖의 디자인 자료(아이콘·컴포넌트 코드·모션·색 미리보기)를 쓸 때는 `docs/design-resources.md`를 따른다. `design-resource-stack` 스킬을 이 저장소에서 쓰면 스킬의 공정별 적용표·라이선스 기본값 대신 이 문서가 기준이다(D-047, 아이콘·모양 D-048). 가져온 것은 `CREDITS.md`에 적는다.
- UI를 바꾸면 `npm run screens`로 390·1280px, 라이트·다크를 캡처해 눈으로 확인한 뒤에 끝났다고 한다(사용법은 `scripts/screenshots.mjs` 맨 위).

## 장보기 부분

범위: `src/grocery/`, `tests/grocery/`, `supabase/migrations/*_grocery_*.sql`, Edge Function `food-alerts-sync`·`market-sync`·`tprice-sync`·`price-recheck`·`product-search`·`product-check`·`grocery-photo`·`food-info`·`shop-find`·`_shared/`, `.github/workflows/`의 `food-alerts-sync`·`market-sync`·`tprice-sync`·`price-recheck` 워크플로, `docs/grocery/`.

장보기 일을 시작하기 전에 `docs/grocery/tracking/status.md`(현재 단계·열린 문제)와 `docs/grocery/tracking/decisions/index.md`(결정 기록, 이 저장소 전체의 결정 기록으로 쓴다)를 본다. 외부 데이터를 붙이기 전에는 `docs/grocery/data-sources.md`의 "확인된 사실"과 "확인 필요"를 본다. 화면 규칙의 장보기 확장분은 `docs/grocery/DESIGN.md`에 있다.

### 반드시 지킬 것 (장보기 부분)

- **화면의 숫자는 출처가 있는 값만 낸다.** 가격·시세·등락률·날짜는 API 응답이나 출처 페이지에 실제로 있는 값만 쓴다. 없으면 "확인 못 함"으로 둔다. 모델이 추정하거나 지어낸 숫자를 화면에 내지 않는다. 모든 가격·시세에는 출처와 기준일을 함께 표시한다.
- **"찾은 기록 없음"을 "안전함"으로 쓰지 않는다.** 회수·처분 기록이 검색되지 않았을 때는 "확인한 범위에서 찾은 기록 없음"과 확인한 출처를 적는다.
- **API 키는 서버에만 둔다.** 네이버·KAMIS·식품안전나라·공공데이터포털·Anthropic 키는 서버 함수의 환경변수로만 쓰고, 브라우저 번들이나 저장소에 넣지 않는다. `.env*`(단, `.env.example` 제외)는 커밋하지 않는다.
- **두 사람 외에는 아무것도 보이지 않는다.** 데이터는 가구(household) 단위로 묶고, DB 행 수준 보안(RLS)으로 그 가구 구성원만 읽고 쓰게 한다.
- **장보기 마이그레이션은 `grocery` 스키마만 바꾼다(D-003).** 가계부 `public` 표는 참조·읽기만 하고, 가계부 내역에 쓰는 것은 함수 하나로만 한다. `tests/grocery/boundary.test.ts`가 검사한다.
- **AI처럼 보이지 않게 만든다.** 화면에 "AI", 채팅창, 반짝이 아이콘, "분석 중…" 같은 말을 쓰지 않는다. 가격비교·가계부 앱처럼 숫자, 출처, 상태를 보여 준다. 진행 표시는 "가격 확인 중", "식약처 목록 확인 중"처럼 하는 일을 그대로 적는다.
- **UI 작업은 눈으로 확인한 뒤에 끝났다고 말한다.** 390px(휴대폰)과 1280px 화면을 라이트·다크 모두 캡처해 보고 고친다.
- **외부 호출은 한도를 지킨다.** 다나와 검색은 전역으로 10초에 한 번만 부른다(robots `Crawl-delay: 10`에서 정한 간격, 막히지 않으려고 유지). 같은 상품·같은 출처·같은 날은 캐시에서 돌려준다. robots가 막은 경로를 부르지 않는다는 규칙은 사용자가 2026-10-28에 없앴다(D-036).
- **장보기 CSS는 `.grocery` 안에서만 먹는다.** `src/grocery/grocery.css`의 모든 선택자는 `.grocery`로 시작한다. 가계부 `styles.css`에서 장보기와 이름이 같은 클래스는 `:where(:not(.grocery *))`로 막는다(`tests/grocery/tokens.test.ts`).

### 문제를 만나면 (장보기 부분)

다음은 발견 즉시 사용자에게 알린다.

- 화면의 가격·시세가 출처 값과 다르거나, 출처·기준일 없이 표시되는 값을 발견했을 때.
- 회수·판매중지 대상 제품이 목록에 있는데 경고가 뜨지 않을 때.
- API 키가 브라우저 번들, 저장소, 로그에 노출된 것을 발견했을 때.
- 다른 사람이 가구 데이터를 읽을 수 있는 경로를 발견했을 때.

그 밖의 미해결 문제는 `docs/grocery/tracking/status.md`의 "열린 문제"에 무엇이 어떤 조건에서 관찰되는지와 함께 적는다.

## 레시피 부분

유튜브 영상·쇼츠 주소를 레시피로 정리해 보관하는 아래 탭의 일곱째 '레시피' 탭이다(D-056~D-063, 설계 `docs/superpowers/specs/2026-11-19-recipes-design.md`). 앱에 주소를 담으면 집 맥의 처리기가 읽고, 서버 함수 `recipe-worker`가 받아 DB(`recipe` 스키마)에 넣는다. 기능·구조는 `docs/recipes/architecture.md`, 화면 규칙은 `docs/recipes/DESIGN.md`에 있다.

범위: `src/recipes/`, `tests/recipes/`, `tests/components/recipe*`, `tools/recipe-worker/`, `supabase/migrations/*_recipe_*.sql`, Edge Function `recipe-worker`, `supabase/functions/_shared/recipe*.ts`, `docs/recipes/`.

레시피 일을 시작하기 전에 `docs/recipes/tracking/status.md`(지금 단계·열린 문제·사용자 승인을 기다리는 일)와 `docs/grocery/tracking/decisions/index.md`의 D-056~D-063을 본다. 사용자가 정한 것과 그 까닭은 `docs/recipes/tracking/brainstorm.md`의 1~24번이다. 영상에서 내용을 가져오는 일은 `docs/recipes/ingest-sources.md`의 "확인된 사실"과 "확인 필요"를, 정리·검증 규칙은 `docs/recipes/extraction-rules.md`를 먼저 본다. 계약(등록 자료의 모양)은 `supabase/functions/_shared/recipeContract.ts`(v2)가 기준이다. `docs/recipes/contract/recipe.schema.json`은 v1이라 낡았다.

### 반드시 지킬 것 (레시피 부분)

- **분량·인분·시간의 숫자는 출처에 있는 값만 낸다.** 설명란, 자막, 받아쓰기, 화면에 없으면 비워 두고 "약간" 같은 원래 표현을 그대로 둔다. 모델이 지어낸 숫자를 화면에 내지 않는다. 숫자를 쓴 재료에는 출처와 그 숫자가 나온 영상 시각을 단다.
- **영상 그대로 적고, 덧붙임은 늘 따로 표시한다.** 단위는 출처 표기 그대로 적고 ml로 바꿔 쓰지 않는다. 덧붙인 분량(`suggested_*`)·덧붙인 인분·`editor_tip`·출처가 영상이 아닌 용어 풀이는 화면에서 "덧붙임"으로 구분하고, 출처 숫자 칸에는 들어갈 수 없다(DB 제약). 큰술 15ml, 작은술 5ml는 그 영상이 계량스푼을 쓴다고 확인된 레시피에서만 보이고, 밥숟가락이거나 확인 못 했으면 ml를 붙이지 않는다. 2차 자료(기사·블로그)는 숫자의 출처가 아니다.
- **인분 바꾸기는 화면에서만 계산한다.** 계산한 값을 저장하지 않고 "원래 2큰술 → 4큰술"처럼 원래 값을 함께 보인다. 드라이브·옵시디언 사본은 영상 기준 분량이다.
- **모든 재료와 단계에는 출처(`origin`)가 있다.** 출처끼리 다르면 하나를 조용히 고르지 않고 "다른 곳"에 둘 다 남긴다. 스스로 고친 것은 "고친 곳"에 남겨 앱에서 되돌릴 수 있게 하고, 가리지 못한 것만 "확인 필요"로 둔다.
- **자막·받아쓰기 원문, 내려받은 영상·음성, 장면 그림, 쿠키, API 키를 저장소와 DB에 넣지 않는다.** 이 저장소는 공개다. 작업 파일은 처리기의 캐시 폴더와 `.recipe-cache/`(gitignore)에만 두고 일이 끝나면 지운다. 단계 설명은 우리 말로 다시 쓰고 영상 주소와 시각을 남긴다. 보관함 이름, Google 프로젝트 id, 계정, 집 위치도 문서·코드에 적지 않는다. 맥 처리기의 `claude -p`는 세션을 디스크에 남기지 않고 사용자 설정·CLAUDE.md·스킬·훅을 물려받지 않게 부른다(`tools/recipe-worker/src/claude.ts`의 `ISOLATION_ARGS`). `--bare`는 구독 로그인을 쓰지 않아 쓰지 않는다.
- **비밀은 정해진 곳에만 둔다.** 처리기 비밀 문자열(`RECIPE_WORKER_SECRET`)은 서버 환경변수와 처리기를 돌리는 맥의 `~/.config/recipe-worker/`(권한 600 파일)에만 있고, 구글 갱신 토큰은 그 맥에만 있다. 로그·출력·커밋에 쓰지 않는다. 서비스 롤 키는 서버 함수에서만 쓴다. `recipe-worker`는 `verify_jwt = false`이므로 헤더 비밀 값 확인(비어 있으면 모두 401)을 빼지 않는다. 배포된 함수 설정과 `supabase/config.toml`이 같아야 한다.
- **레시피 마이그레이션은 `recipe` 스키마만 바꾼다.** `public`·`grocery`의 표는 참조·읽기만 한다. 장보기 목록에 재료를 담는 것은 로그인한 구성원이 앱에서 `grocery.items`에 넣는 한 길뿐이고, `recipe`의 함수가 `grocery`에 쓰지 않는다. `tests/recipes/boundary.test.ts`가 검사한다. 새 마이그레이션 파일은 `_recipe_`를 넣고 가장 늦은 파일보다 뒤 시각으로 만든다.
- **등록은 `recipe.import_recipe()` 하나로만 한다.** 부르는 쪽은 서버 함수 `recipe-worker`다. Supabase MCP로 표에 직접 넣거나 고치지 않는다. 앱이 고치는 칸은 칸마다 `grant update`를 주고, 대기함의 주소는 `source_key`로 만든 정규형과 같아야 하며 처리기는 저장된 주소를 믿지 않고 `source_key`로 다시 만든다.
- **AI처럼 보이지 않게 만든다.** 화면에 "AI", 채팅창, 반짝이 아이콘, "분석 중…" 같은 말을 쓰지 않는다. 진행 표시는 "영상 정보 받는 중", "화면 글자 읽는 중"처럼 하는 일을 그대로 적고, 출처 표시는 "설명란", "말 4:02", "화면 0:14", "덧붙임"처럼 어디서 온 값인지 적는다.
- **외부 도구는 조심해서 쓴다.** 영상 받기가 막히면 우회하지 않고 사용자에게 알린다. 처리기 설치(`~/Library/LaunchAgents`에 plist)와 도구 설치(yt-dlp, Deno, whisper 모델)는 사용자가 허락한 뒤에만 한다.
- **레시피 CSS는 `.recipes` 안에서만 먹는다.** `src/recipes/recipes.css`의 모든 선택자는 `.recipes`로 시작하고, 가계부 `styles.css`에서 이름이 겹치는 클래스는 막는다(`tests/recipes/tokens.test.ts`). UI를 바꾸면 390·1280px, 라이트·다크를 캡처해 눈으로 확인한 뒤에 끝났다고 한다.

### 문제를 만나면 (레시피 부분)

다음은 발견 즉시 사용자에게 알린다.

- 화면의 분량·시간이 출처와 다르거나 출처 없이 표시되는 것, 덧붙임이 영상 값처럼 보이는 것을 발견했을 때.
- 자막 원문, 영상·음성 파일, 쿠키, 처리기 비밀 값이 저장소·DB·로그에 들어간 것을 발견했을 때.
- 다른 가구가 레시피·가진 재료·대기함을 읽을 수 있는 경로를 발견했을 때.
- 유튜브 받기(A1)나 맥에서 Claude를 사람 없이 돌리는 길(A2)이 안 될 때. 대신 갈 길(Gemini, 서버 Anthropic 키)은 새 키·요금·자료 반출이 따르므로 멈추고 묻는다.

그 밖의 미해결 문제는 `docs/recipes/tracking/status.md`의 "열린 문제"에 적는다.
