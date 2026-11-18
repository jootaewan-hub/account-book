# 레시피: 구조

> **2026-11-18 브레인스토밍으로 일부가 낡았다.** 바뀐 내용과 낡은 곳은 `tracking/brainstorm.md`에 있고, 그 문서가 우선한다. 설계 문서가 승인되면 이 문서를 고친다.

제안이다. 확정은 `tracking/decisions-proposed.md`의 P-01~P-12를 거친다.

## 한눈에

```
 영상·글 주소
     │
     ├─ PC ──────── Claude Code  /recipe-ingest  ── L0~L4 전부 ──┐
     │              (yt-dlp, 받아쓰기, 장면 읽기)                 │  계약 JSON 한 건
     ├─ 밖(휴대폰) ─ claude.ai   레시피 담기 스킬 ── L0~L1 ───────┤  (contract/recipe.schema.json)
     │              (브라우저·자막 도구)                          │
     └─ 앱 ──────── 대기함에 주소만 ──→ 위 둘 중 하나가 나중에 읽음 │
                                                                 ▼
                                             recipe.import_recipe()  ← 등록은 이 함수 하나
                                                                 │
                              Supabase `account-book` · 스키마 recipe (RLS: 가구 구성원만)
                                                                 │
                         가계부 앱 '레시피' 부분 (src/recipes/) ── 검토 → 레시피북 → 요리 → 뭐 해 먹지
                                                                 │
                                                  장보기 목록(grocery.items)에 모자란 재료 담기
```

## 구성

| 부분 | 선택 | 이유 |
|---|---|---|
| 앱 | 가계부 저장소 안 `src/recipes/`(React 19, TS, Vite, PWA). 탭 또는 장보기 안의 화면 | 계정·가구·디자인·배포를 그대로 쓴다(D-010과 같은 판단). 위치는 P-11에서 정한다 |
| 데이터 | 같은 Supabase 프로젝트의 `recipe` 스키마, RLS는 `private.is_household_member` | 장보기의 `grocery` 스키마와 같은 방식 |
| 읽기(수집·정리) | 앱 서버가 아니라 Claude Code와 claude.ai | 영상 사이트는 서버에서 읽기 어렵고 막히기 쉽다. 두 사람이 쓰는 양이면 구독 안에서 된다. 서버 함수·API 요금·비공식 도구가 앱 운영에 묻지 않는다 |
| 등록 | DB 함수 `recipe.import_recipe(가구, 사람, JSON, 덮어쓰기)` 하나 | 두 곳에서 넣어도 모양이 같고, 검증과 권한 확인이 한곳에 있다 |
| 계약 | `docs/recipes/contract/recipe.schema.json` v1 | Claude Code 스킬, claude.ai 스킬, DB 함수, 앱의 zod 타입이 모두 이것을 따른다 |
| 가진 재료 대조 | DB 함수 `recipe.cookable()`과 재료 표준 사전 `recipe.ingredient_dict` | 쿡앱의 핵심 불변식(레시피 재료 = 사전 id)을 가져오되 검색 서버 없이 Postgres로 한다 |
| 앱 안에서 읽기(선택, R8) | 글 붙여넣기·요리책 사진만, Edge Function + 가계부와 같은 WIF(D-009) | 영상 사이트에 가지 않는 입력은 앱 안에서도 된다 |

## 두 곳의 역할

| | Claude Code (PC·맥북) | claude.ai (웹·휴대폰) |
|---|---|---|
| 앱 만들기 | 전부 | 설계 문서, 조사, 비교 |
| 영상 읽기 | L0~L4 전부: 설명란, 자막, 받아쓰기, 장면, 2차 자료 | L0~L1: 설명란과 자막. 그 이상이 필요하면 초안에 빈 곳을 표시하고 넘긴다 |
| 등록 | Supabase MCP로 `import_recipe` 호출 | Supabase 커넥터로 같은 함수 호출 |
| 대기함 | 쌓인 주소를 한꺼번에 처리, 빈 곳 채우기 | 주소 담기, 가능한 것은 바로 읽기 |
| 마이그레이션 | `apply_migration`(사용자 확인 뒤) | 하지 않는다 |

claude.ai에서 읽을 수 있는 범위는 그때 켜져 있는 도구에 달려 있다(`claude-ai-workflow.md`). 그래서 claude.ai 쪽 결과는 늘 "어디까지 봤는지"(`extraction.levels`, `not_checked`)를 남기고, Claude Code가 나중에 같은 출처를 `p_replace = true`로 다시 읽어 채울 수 있게 한다.

## 데이터 흐름

1. **모으기.** 출처에서 증거를 모은다. 단계는 `ingest-sources.md`의 L0~L4이고, 앞 단계로 충분하면 멈춘다. 모은 것은 `.recipe-cache/<출처 열쇠>/evidence.json`에만 둔다(저장소·DB에 넣지 않는다).
2. **정리.** `extraction-rules.md`대로 계약 JSON을 만든다. 재료 이름을 사전에 맞춰 `ingredient_key`를 붙인다.
3. **검사.** 스키마 통과, 단계의 `uses`가 재료 목록에 있는지, 필수 재료가 어느 단계에도 안 쓰이지 않는지, 숫자의 출처가 맞는지.
4. **등록.** 요약을 사용자에게 보이고 `import_recipe`를 부른다. `draft`로 들어간다.
5. **검토.** 앱에서 확인이 필요한 곳을 보고 `saved`로 바꾼다. 사람이 고친 값의 출처는 `user`가 된다.
6. **쓰기.** 레시피북, 요리 모드, `cookable()`은 `saved`만 본다.

## 경계 규칙

- 레시피 마이그레이션은 `recipe` 스키마 안의 객체만 만들고 바꾼다. 파일 이름에 `_recipe_`를 넣고, `tests/grocery/boundary.test.ts`와 같은 검사를 `tests/recipes/`에 둔다(대상에 `grocery` 스키마 쓰기도 더한다).
- 적용은 Supabase MCP `apply_migration`만, 사용자 확인 뒤(저장소 공통 규칙).
- 장보기로 가는 길은 하나다: 로그인한 사용자가 앱에서 `grocery.items`에 넣는다. 장보기의 RLS와 제약(이름 60자, 분류 11종, 담은 사람 = 본인)을 그대로 따른다. `recipe`의 함수가 `grocery`에 쓰지 않는다.
- 장보기·가계부에서 읽는 것(산 품목, 영수증 품목)은 읽기만 한다.
- 사전(`ingredient_dict`)은 가구와 무관한 공용 자료다. 앱 사용자는 읽기만 하고, 넣고 고치는 것은 마이그레이션이나 MCP로만 한다.

## DB (초안: `contract/db-draft.sql`)

| 표·함수 | 내용 |
|---|---|
| `recipe.recipes` | 레시피 한 건. 상태(draft/saved/archived), 출처(종류·열쇠·주소·채널·올린 날), 인분(출처 값과 덧붙임을 따로), 분류 네 축, 원리, 충돌, 읽은 기록, 확인 필요 수, 우리 집 메모·별점·즐겨찾기 |
| `recipe.ingredients` | 재료 줄. 묶음, 이름, 숫자 분량·단위, 숫자가 아닌 표현, 선택 여부, 출처, 덧붙인 분량, 사전 id, 확인 필요 |
| `recipe.steps` | 단계. 제목, 할 일, 불 세기, 넘어가는 신호와 그 출처, 덧붙임, 타이머, 영상 시작 시각, 쓰는 재료, 출처 |
| `recipe.ingredient_dict` | 재료 표준 사전(쿡앱 형식): id, 표준명, 영어명, 동의어, 대분류 14종, 상위 묶음 |
| `recipe.pantry` | 가진 재료. 지금 있음(have)과 늘 있음(always), 어디서 알았는지(직접·장보기·영수증) |
| `recipe.inbox` | 주소 대기함. 상태(waiting/done/needs_more/failed) |
| `recipe.import_recipe()` | 계약 JSON 한 건을 초안으로 등록. 같은 출처는 덮어쓰기 옵션이 있을 때만(메모·별점은 남김) |
| `recipe.cookable()` | 가진 재료 기준으로 만들 수 있는 요리. 모자란 수가 적은 순 |

DB 제약이 규칙을 한 번 더 막는다: 숫자 분량이 있는 줄의 출처는 `secondary`·`editor`일 수 없고, 인분 숫자에는 출처가 있어야 한다.

## 개인정보·저작권·약관

- 두 사람만 쓰는 사적 기록이다. 그래도 저장소가 공개라서 원문(자막, 받아쓰기)과 매체 파일은 저장소에 두지 않고, DB에도 넣지 않는다.
- 단계 설명은 다시 쓴 글이고, 출처 주소·채널·단계별 시각을 함께 둔다.
- yt-dlp 같은 도구로 자막·영상을 받는 것은 각 서비스 약관과 맞지 않을 수 있다. 개인 용도, 적은 양, 읽은 뒤 삭제로 범위를 좁히고, 막히면 우회하지 않는다. 공개 서비스로 바꿀 계획이 생기면 이 구조를 다시 본다.
- 쿡앱에서 가져오는 자료는 공공누리 제1유형·제한 없음 출처와 직접 만든 것만이다(`cookapp-absorb.md`).

## 비용

- 읽기: Claude 구독 안. 받아쓰기는 PC에서 돈다. 화면 전체 이해가 필요할 때 쓰는 Gemini API만 선택 사항이고 유료일 수 있다(P-07).
- 앱: 새 서버 함수 없이 시작한다. R8에서 글·사진 읽기를 넣으면 가계부의 WIF를 같이 쓴다.
