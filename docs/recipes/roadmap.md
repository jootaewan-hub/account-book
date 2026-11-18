# 레시피: 단계

> **2026-11-18 브레인스토밍으로 일부가 낡았다.** 바뀐 내용과 낡은 곳은 `tracking/brainstorm.md`에 있고, 그 문서가 우선한다. 설계 문서가 승인되면 이 문서를 고친다.

단계마다 저장소의 작업 방식대로 간다: `superpowers:brainstorming` → 설계(`docs/superpowers/specs/`) → 계획(`docs/superpowers/plans/`) → 구현 → 화면 캡처 확인 → 사용자 확인 뒤 적용·배포. 아래는 그 설계의 출발점이지 설계 자체가 아니다. "시킬 말"은 Claude Code에 그대로 넣는 말이다.

| 단계 | 내용 | 앞 단계 | 끝나면 되는 것 |
|---|---|---|---|
| R0 | 결정 확정, 문서 넣기, 도구 확인 | — | 무엇을 어디에 만들지 정해짐 |
| R1 | 계약과 DB | R0 | 계약 JSON 한 건이 DB에 초안으로 들어감 |
| R2 | 수집 스킬(유튜브, L0~L1) | R1 | PC에서 주소 → 초안 등록 |
| R3 | 레시피북 화면(보기) | R1 | 앱에서 레시피를 찾고 읽음 |
| R4 | 검토, 고치기, 대기함 | R3 | 초안을 확인하고 레시피북에 넣음. 앱에서 주소 담기 |
| R5 | claude.ai 스킬 | R1, R2 | 밖에서 담기 |
| R6 | 쇼츠·릴스(L2~L4) | R2 | 자막 없는 영상, 화면 글자, 파일로 넣기 |
| R7 | 뭐 해 먹지, 장보기 담기, 요리 모드 | R4, 사전 | 쿡앱의 목표 |
| R8 | (선택) 앱 안에서 글·사진 읽기, 공공 한식 레시피 | R4, R7 | Claude 없이도 담기, 후보 넓히기 |

R3과 R2는 같이 갈 수 있다. R5는 R2에서 규칙이 굳은 뒤가 좋다.

---

## R0 결정과 준비

- `tracking/decisions-proposed.md`의 P-01~P-12를 사용자와 하나씩 정해 저장소 결정 기록(`docs/grocery/tracking/decisions/index.md`)에 다음 번호로 옮긴다.
- `CLAUDE.md`에 레시피 부분을 붙이고 `.gitignore`에 `.recipe-cache/`를 더한다.
- PC에서 확인: `yt-dlp --version`, `ffmpeg -version`, 파이썬과 `faster-whisper` 설치 여부, 그래픽카드 유무, 쿡앱 폴더의 `data/normalized/`가 남아 있는지.
- 완료 기준: 결정 기록에 번호가 붙었고, `tracking/status.md`의 "확정할 결정"이 비었다.

시킬 말:
```
docs/recipes/tracking/status.md, roadmap.md, tracking/decisions-proposed.md를 읽어.
P-01부터 하나씩 나에게 물어 정하고, 정한 것은 docs/grocery/tracking/decisions/index.md에 다음 번호로 적어.
그다음 CLAUDE.md에 레시피 부분을 붙이고 .gitignore에 .recipe-cache/를 더해. 내 PC의 도구 상태도 확인해서 status.md에 적어.
```

## R1 계약과 DB

- `contract/db-draft.sql`을 `supabase/migrations/<가장 늦은 파일 뒤>_recipe_init.sql`로 옮긴다. 설계에서 다시 볼 것: 대기함을 함수로 감쌀지, `review_count`를 트리거로 맞출지, 분류 낱말을 DB에서도 막을지.
- `src/recipes/lib/contract.ts`: 계약의 zod 판. `contract/recipe.schema.json`과 같은지 시험으로 묶는다(예시 통과, 잘못된 자료 8가지 거름).
- `tests/recipes/`: PGlite로 등록 함수, 가구 분리, 덮어쓰기에서 메모가 남는지, `cookable`, 경계 검사(`recipe` 밖을 바꾸지 않음). 2026-11-18에 초안으로 돌려 본 확인 목록이 `tracking/status.md`에 있다.
- 사용자 확인 뒤 `apply_migration`. Exposed schemas에 `recipe` 추가(장보기 때와 같은 절차). 보안 점검(Advisors)을 적용 전후로 비교.
- 완료 기준: 공유 DB에 `recipe` 스키마가 있고, Supabase MCP로 예시 JSON을 등록하면 초안 한 건이 생긴다. `npm test` 통과.

시킬 말:
```
레시피 R1을 한다. docs/recipes/architecture.md, contract/ 폴더 전체, tracking/status.md를 읽고
superpowers:brainstorming으로 설계를 시작해. db-draft.sql은 초안이니 가계부 마이그레이션 규칙(이름 순서, PGlite 시험, 경계 검사)에 맞게 다듬어.
공유 DB 적용은 내가 확인한 뒤에만.
```

## R2 수집 스킬 (유튜브, L0~L1)

- `.claude/skills/recipe-ingest/`의 초안을 실제로 돌려 고친다. `ingest-sources.md`의 "확인 필요" 가운데 yt-dlp 항목을 PC에서 확인하고 문서를 고친다.
- 스크립트로 뺄 것: 주소 → 출처 열쇠, 자막 json3 → `{start, text}` 줄, 계약 검사, 마지막 검사(정리 규칙 8절). 가계부 저장소의 k-skill처럼 `scripts/` 아래 둔다.
- 기준 답안 대조: `youtube:AkX6uA4BaDs`를 돌려 `contract/examples/`와 비교(재료 15가지 숫자, 나눠 넣기, 충돌 세 군데, 단계 시각 ±15초).
- 재료 이름 → 사전 id 맞추기는 사전이 들어온 뒤(R7 앞)에 붙인다. 그 전에는 비운다.
- 완료 기준: `/recipe-ingest <유튜브 주소>` 한 번으로 초안이 등록되고, 요약에 확인 필요 수와 어디까지 봤는지가 나온다. 서로 다른 채널의 영상 5개로 확인.

시킬 말:
```
레시피 R2를 한다. .claude/skills/recipe-ingest/SKILL.md, docs/recipes/ingest-sources.md, extraction-rules.md를 읽어.
먼저 예시 영상(AkX6uA4BaDs)으로 L0와 L1 명령을 실제로 돌려 결과 모양을 확인하고 ingest-sources.md의 '확인 필요'를 고쳐.
그다음 기준 답안과 대조하면서 스킬을 다듬어. 내려받은 것은 .recipe-cache/에만 두고 끝나면 지워.
```

## R3 레시피북 화면

- 위치(P-11)에 따라 탭 또는 장보기 안. `src/recipes/RecipesTab.tsx`, CSS는 `.recipes` 안에서만.
- 목록(찾기, 분류 네 축, 즐겨찾기), 상세(재료 묶음, 분량 배수, 순서, 원리, 메모, 출처).
- 분량 배수: 숫자 분량만 곱한다. "약간"은 그대로. 덧붙임은 구분해 보인다. 단계의 영상 시각은 `source_url&t=<초>`로 연다.
- 출처 태그 낱말과 "덧붙임" 표시를 `docs/recipes/DESIGN.md`에 정한다. 12단계를 큰 단계로 묶어 보일지도 여기서.
- `npm run screens`에 레시피 화면을 더하고 390·1280, 라이트·다크로 확인.
- 완료 기준: 등록된 레시피 3건 이상을 앱에서 찾아 읽을 수 있고 화면의 숫자가 DB 값과 같다.

시킬 말:
```
레시피 R3를 한다. docs/recipes/product.md의 화면 목록과 DESIGN.md, docs/grocery/DESIGN.md를 읽고
superpowers:brainstorming으로 레시피북 목록과 상세 화면을 설계해. 화면 문구에 AI라는 말을 쓰지 않는다.
```

## R4 검토, 고치기, 대기함

- 검토 화면: `needs_review`인 재료·단계·원리와 `conflicts`만 모아 보기. 충돌은 둘 중 고르기. 사람이 고친 값은 출처 `user`. 다 보면 `saved`.
- 고치기: 재료 줄·단계 더하기, 빼기, 순서 바꾸기. 직접 쓰기(출처 `manual`).
- 대기함: 주소 붙여넣기 → `recipe.inbox`. 휴대폰의 공유 메뉴에서 바로 받기(PWA share target)는 확인 필요.
- 완료 기준: 초안 → 검토 → 저장이 앱에서 끝난다. 대기함에 넣은 주소가 Claude Code에서 보인다.

## R5 claude.ai 스킬

- `claude-ai-workflow.md`의 사양으로 claude.ai에서 스킬을 만든다. 가구·사람 id를 넣는다.
- 대기함 처리와 바로 읽기를 유튜브 3건으로 확인. 읽지 못하는 경우에 지어내지 않고 대기함에 넣는지 확인.
- 완료 기준: 휴대폰 claude.ai에서 주소를 주면 초안이 생기거나 대기함에 들어간다.

## R6 쇼츠와 릴스

- L2 받아쓰기, L3 장면 읽기, L4 대조를 스킬에 더한다. 단계마다 "충분한가" 판단을 넣어 필요할 때만 올라간다.
- 인스타: 로그인 없이 되는 범위 확인, 파일로 넣기 흐름, 쿠키 방침(P-09).
- Gemini API를 쓸지(P-07) 화면 글자 위주 영상 3개로 비교한다.
- 기준 답안을 쇼츠 1건, 릴스 1건 더한다.
- 완료 기준: 자막 없는 쇼츠와 릴스 파일에서 초안이 나오고, 화면에서 읽은 값의 출처가 `screen`으로 남는다.

## R7 뭐 해 먹지

- 사전 들여오기(`cookapp-absorb.md`의 "사전 옮기기"), 장보기 분류와 잇는 표.
- 수집 스킬과 검토 화면에 재료 맞추기(R-13)를 붙이고, 이미 있는 레시피를 한 번 맞춘다.
- 가진 재료 화면(직접 고르기, 늘 있음), 장보기에서 산 것을 후보로.
- `cookable` 결과 화면, 모자란 재료를 `grocery.items`에 담기(장보기 제약에 맞춰).
- 요리 모드(큰 글씨, 화면 꺼짐 방지, 타이머)와 "해 봤음" 기록.
- 완료 기준: 가진 재료를 고르면 저장한 레시피가 모자란 수 순으로 나오고, 모자란 재료가 장보기 목록에 들어간다.

시킬 말:
```
레시피 R7을 한다. docs/recipes/cookapp-absorb.md를 읽고, 내 PC의 쿡앱 폴더(cookapp-claude)에서 data/normalized/가 남아 있는지 먼저 확인해.
그 결과에 따라 사전을 어떻게 들여올지 제안하고, superpowers:brainstorming으로 '뭐 해 먹지' 화면을 설계해.
```

## R8 (선택)

- 앱 안에서 글 붙여넣기·요리책 사진 읽기: Edge Function `recipe-read`, 가계부 `extract-entries`·`grocery-photo`와 같은 WIF. 같은 계약, 같은 등록 함수.
- 공공 한식 레시피(식약처 COOKRCP01, 농진청)를 `recipe.catalog`로 넣어 "뭐 해 먹지" 후보에 더하기. 출처 표시. 식품안전나라 COOKRCP01 활용신청 필요.
- 궁합·재료 성질(쿡앱의 미뤄 둔 부분)은 여기서도 하지 않는다. 따로 결정한다.
