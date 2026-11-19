# 레시피: 구조

2026-11-19 승인된 설계(`docs/superpowers/specs/2026-11-19-recipes-design.md`)와 코드에 맞춰 다시 썼다. 결정은 `docs/grocery/tracking/decisions/index.md`의 D-056~D-063이다. 처음 제안(2026-11-18)은 `tracking/decisions-proposed.md`에 채택·뒤집음·뺌으로 표시해 두었다.

## 한눈에

```
휴대폰 앱에 붙여넣기 / 맥·PC 북마크(?tab=recipes&add=주소)
  → recipe.inbox 에 한 줄 (대기)
  → 맥 처리기(launchd)가 서버 함수 recipe-worker 로 일을 받음 (맥이 꺼져 있거나 잠들면 대기)
      1 수집   설명란·자막(L0·L1) → (없으면) 받아쓰기(L2) → 장면·화면 글자(L3)
      2 정리   claude -p: 근거 → 레시피(계약 v2)
      3 검증   기계 검사 → 두 번째 읽기 → 다른 곳 맞춰 고치기 → 남은 것은 "확인 필요"
      4 등록   recipe-worker 가 검사하고 recipe.import_recipe 로 넣음
  → 앱: 확인 필요가 없으면 레시피북, 있으면 "확인 필요"
  → 레시피북에 들어간 것은 맥이 구글 드라이브·옵시디언에 씀 (앱에서 고치면 다시 씀)
  → 가진 재료와 비교, 모자란 재료는 앱이 장보기 목록(grocery.items)에 담음
```

## 구성

| 부분 | 선택 | 이유 |
|---|---|---|
| 앱 | 가계부 저장소 안 `src/recipes/`(React 19, TS, Vite, PWA). 아래 탭의 일곱째 '레시피'(D-056). 늦게 불러오기(lazy), CSS는 `.recipes` 안에서만 | 계정·가구·디자인·배포를 그대로 쓴다(D-010과 같은 판단) |
| 데이터 | 같은 Supabase 프로젝트의 `recipe` 스키마. 마이그레이션 셋: `*_recipe_init.sql`(표·RLS·대기함 함수), `*_recipe_import.sql`(등록 함수), `*_recipe_pantry.sql`(사전·가진 재료·`cookable`) | 장보기의 `grocery` 스키마와 같은 방식. RLS는 `private.is_household_member` |
| 읽기 | 집 맥의 처리기 `tools/recipe-worker/`(TypeScript, Node 25, launchd). 설치한 사본에서 돈다(`install.sh <커밋>`, 이름 `local.recipe-worker`) | 유튜브는 데이터센터 요청을 자주 막고, 서버 함수에서는 yt-dlp·ffmpeg·받아쓰기를 못 돌리고, 가계부가 쓰는 Claude API는 영상을 받지 않는다(D-057) |
| 서버 함수 | `supabase/functions/recipe-worker/`. `verify_jwt = false`, 헤더 `x-recipe-worker-secret`을 환경변수 `RECIPE_WORKER_SECRET`과 시간 일정 비교(`_shared/secret.ts`). 값이 비면 모두 401 | 처리기가 로그인 없이 부른다. 서비스 롤 키는 서버에만 있고 처리기는 비밀 문자열 하나만 가진다 |
| 계약 | v2: `supabase/functions/_shared/recipeContract.ts`(zod). 앱, 처리기, 서버 함수가 같은 코드를 쓴다. `contract/recipe.schema.json`은 v1이라 낡았다 | 한 곳의 검사를 세 곳이 쓴다 |
| 보관 | 맥이 구글 드라이브(`drive.file` 권한)와 옵시디언(iCloud 보관함)에 확인을 마친 레시피를 쓴다(D-062) | 원본은 앱(DB), 드라이브·옵시디언은 보관 사본 |

## 처리기 (맥)

- 20초마다 서버 함수에 일을 묻고(Realtime 대신), 진행 단계를 30초마다 알린다. 3분 끊기면 다른 실행이 가져갈 수 있고(`claim_job`), 한 일은 세 번까지 한다. Claude 사용량 제한으로 미룬 일은 세 번에 세지 않는다.
- 하루 한도(처음값 15, 설정에서 바꿈)는 가져간 일을 모두 센다. 켜진 시간(처음값 08:30~18:20, 20:00~06:30)에는 일이 없어도 잠을 막고, 일하는 동안에는 늘 막는다(`caffeinate -i`).
- 정리에 쓰는 `claude -p`는 그 일의 작업 폴더 안 파일 읽기만 허락한다(`--tools Read`, 셸·쓰기·웹 막음). 설명란·자막·화면 글자는 믿지 않는 입력이라 울타리를 친 자료 블록 안에 JSON 값으로만 넣는다.
- 대기함의 주소는 정규형(`https://www.youtube.com/watch?v=<id>` 또는 `/shorts/<id>`)과 같아야 하고(DB 검사), 처리기는 저장된 주소를 믿지 않고 `source_key`로 다시 만든다. 60분이 넘는 영상은 받지 않는다.
- 작업 파일(영상·소리·장면·자막)은 `~/Library/Caches/recipe-worker/<일 id>/`에만 두고 일이 끝나면 지운다(실패한 일은 하루). 저장소의 `.recipe-cache/`는 손으로 하는 시험에만 쓴다.
- `doctor` 명령이 도구·권한·서버 연결을 점검한다(드라이브 시험 파일은 만들고 곧 지운다).

## 서버 함수가 하는 일

일 받기(`claim`), 진행 알림, 결과 넣기(계약 v2 검사 → 난이도 계산 → `import_recipe` → 대기 줄 끝냄), 실패 알리기, 일 미루기(사용량 제한), 보낼 것 묻기(`exports`: 확인을 마쳤고 마지막으로 쓴 뒤 바뀐 레시피), 보낸 것 적기(`exported`), 사전 항목 더하기, 살아 있음 알리기. 오류는 계약·권한 문제(409)와 일시 오류(500, 처리기가 다시 함)로 나눈다. 요청 크기는 1MB로 막는다. 설계가 요구한 요청 횟수 한도는 아직 만들지 않았다(열린 일, `tracking/status.md`).

## 데이터 (`recipe` 스키마)

| 표·함수 | 내용 |
|---|---|
| `recipe.recipes` | 레시피 한 건. 상태 `review`(확인 필요 있음)·`saved`·`archived`, 출처(열쇠 `youtube:<id>`, 주소, 채널), 인분(출처 값과 덧붙임 따로), 분류, 난이도와 근거, 계량 도구와 근거, 원리, 용어 풀이, 다른 곳, 고친 곳, 확인 필요 목록과 수, 우리 집 메모·별점·즐겨찾기 |
| `recipe.ingredients`, `recipe.steps` | 재료 줄(출처, 근거 시각, 덧붙인 분량, 사전 열쇠)과 단계(불, 넘어가는 신호, 타이머, 영상 시각, 쓰는 재료) |
| `recipe.inbox` | 주소 대기함. 상태 `waiting`·`processing`·`done`·`failed`, 진행 단계, 시도 횟수, 가져간 시각. 같은 가구에서 같은 출처의 대기·처리 중 줄은 하나만 |
| `recipe.ingredient_dict` | 재료 표준 사전. 비어서 시작해 처리기가 `dict_add`로 늘린다. 앱은 읽기만 |
| `recipe.pantry` | 가진 재료(지금 있음·늘 있음). 어디서 알았는지 `manual`·`grocery`·`receipt` |
| 처리기 상태, 보관 기록 | 살아 있음 표시(마지막 확인 시각, 버전), 레시피별 드라이브 파일 id·옵시디언 경로·쓴 시각. 서비스 롤만 쓰고 구성원은 읽는다 |
| `recipe.import_recipe()` | 계약 한 건을 등록. 같은 출처가 있으면 덮어쓰고 우리 집 메모·별점은 남긴다. 사전에 없는 열쇠는 비워서 저장한다. 등록은 이 함수 하나로만 한다 |
| `recipe.cookable()` | 가진 재료 기준으로 만들 수 있는 요리. 없어도 되는 재료와 늘 있음은 모자람에 세지 않는다 |
| `recipe.claim_job()` 등 | 일 받기·진행·미루기·실패, 구성원용 `retry_job()`(다시 하기) |

DB 제약이 규칙을 한 번 더 막는다: 숫자 분량이 있는 줄에는 덧붙임 칸이 못 들어가고, 숫자 칸의 출처는 `editor`일 수 없고, 인분 숫자에는 출처가 있어야 한다. 앱이 고치는 칸은 칸마다 `grant update`를 따로 준다(빠지면 고치기 전체가 권한 오류).

## 경계 규칙

- 레시피 마이그레이션은 `recipe` 스키마 안의 객체만 만들고 바꾼다(파일 이름에 `_recipe_`). `tests/recipes/boundary.test.ts`가 검사한다. `public`은 참조·읽기만, `grocery`는 건드리지 않는다.
- 적용은 Supabase MCP `apply_migration`만, 사용자 확인 뒤(저장소 공통 규칙). 앱이 `recipe`를 읽으려면 대시보드의 Exposed schemas에 `recipe`를 더해야 한다(사용자).
- 장보기로 가는 길은 하나다: 로그인한 사용자가 앱에서 `grocery.items`에 넣는다. 장보기의 RLS와 제약(이름 60자, 담은 사람 = 본인)을 그대로 따른다. `recipe`의 함수가 `grocery`에 쓰지 않는다.
- 장보기·가계부에서 읽는 것(산 품목)은 읽기만 한다.

## 개인정보·저작권·약관

- 영상·소리·장면 그림·자막과 받아쓰기 원문은 저장소, DB, 드라이브, 옵시디언 어디에도 넣지 않는다. 남기는 것은 다시 쓴 글, 숫자, 출처, 영상 시각이다(P-06 그대로).
- 저장소가 공개라서 보관함 이름, Google 프로젝트 id, 계정, 집 위치를 문서·코드에 적지 않는다.
- 비밀: 처리기 비밀 문자열은 서버 환경변수와 맥의 `~/.config/recipe-worker/`(권한 600), 구글 갱신 토큰은 그 맥에만 있다. 로그에 쓰지 않는다.
- yt-dlp 같은 도구로 영상을 받는 것은 서비스 약관과 맞지 않을 수 있다. 개인 용도, 적은 양, 읽은 뒤 삭제로 범위를 좁히고, 막히면 우회하지 않는다.

## 비용

- 읽기: Claude 구독 안(하루 한도로 묶음). 받아쓰기·글자 인식·장면 뽑기는 맥에서 돈다. 새 키·API 요금은 없다.
- 맥이 사람 없이 Claude를 돌리는 길이 안 되면(A2) 서버 키로 정리하는 길은 새 키·요금이 생겨, 그때 사용자에게 묻는다(D-063).
