# 레시피: claude.ai에서 하는 일

> **낡음(2026-11-19).** 이 문서는 읽는 일을 claude.ai가 맡는다는 처음 제안(P-02, P-08)의 흐름이다. 설계가 승인되면서 읽기는 집 맥의 처리기가 하고(D-057), claude.ai에서 자막을 읽어 등록하는 길은 두지 않기로 했다(D-063, 사용자 결정 7·8·10·17번). 지금 구조는 `architecture.md`와 `docs/superpowers/specs/2026-11-19-recipes-design.md`에 있다. 아래는 그때의 생각을 남겨 둔 것이고, 맥 처리기가 막혔을 때 손으로 다시 읽는 예비 길을 생각할 때만 참고한다.

Claude Code는 PC 앞에서, claude.ai는 어디서나 쓴다. 둘이 같은 계약과 같은 등록 함수를 쓰기 때문에 어느 쪽에서 담아도 레시피북에는 같은 모양으로 들어온다.

## claude.ai가 맡는 일

| 일 | 내용 | 필요한 것 |
|---|---|---|
| 주소 담기 | 밖에서 본 영상 주소를 대기함(`recipe.inbox`)에 넣는다 | Supabase 커넥터, R1 |
| 바로 읽기 | 설명란과 자막(L0~L1)으로 초안을 만들어 등록한다 | 아래 "읽는 길" 가운데 하나, R1 |
| 대기함 처리 | "레시피 대기함 처리해 줘" → 쌓인 주소를 차례로 읽는다 | 위와 같음 |
| 검토 돕기 | 초안의 확인 필요한 곳을 말로 물어 고친다 | Supabase 커넥터 |
| 설계·조사 | 문서, 도구 비교, 디자인 방향 | — |

claude.ai가 하지 않는 일: 마이그레이션 적용, 표에 직접 쓰기, 받아쓰기(L2), 장면 읽기(L3). 그 이상이 필요하면 초안의 `gaps`와 `not_checked`에 적고, 대기함 상태를 `needs_more`로 둔다. Claude Code가 다음에 채운다.

## 읽는 길 (위에서부터 되는 것을 쓴다)

1. **자막 도구가 연결돼 있으면** 그것(예: TubeAlfred 플러그인, Firecrawl 커넥터). 휴대폰에서도 된다. 쓸지는 P-08에서 정한다.
2. **데스크톱 앱이 켜져 있으면** 내장 브라우저로 영상 페이지를 열어 설명란을 펼치고 스크립트 패널을 읽는다. 2026-11-18에 이 방식으로 됐다.
3. **둘 다 안 되면** 대기함에 주소만 넣고 그렇게 말한다. 기억이나 검색 결과로 레시피를 지어내지 않는다.

인스타그램은 claude.ai에서 읽지 않는다. 게시글 본문을 사용자가 붙여 넣으면 그 글(출처 `description`)로 초안을 만들고, 영상 내용은 `not_checked`에 적는다.

## 등록하는 방법

가구와 사람의 id는 처음 한 번 찾아 스킬에 적어 둔다(저장소에는 적지 않는다).

```sql
-- 처음 한 번: 내 가구와 내 id
select m.household_id, m.user_id, m.display_name
from public.members m join auth.users u on u.id = m.user_id
where u.email = '<가계부 로그인 이메일>';

-- 등록: 계약 JSON 한 건. 돌려주는 값은 레시피 id
select recipe.import_recipe('<가구 id>', '<내 id>', $recipe$ { …계약 JSON… } $recipe$::jsonb);

-- 같은 출처를 다시 읽어 덮어쓸 때(메모·별점은 남는다)
select recipe.import_recipe('<가구 id>', '<내 id>', $recipe$ { … } $recipe$::jsonb, true);

-- 대기함
insert into recipe.inbox (household_id, url, note, added_by) values ('<가구 id>', '<주소>', '<메모>', '<내 id>');
select id, url, note from recipe.inbox where household_id = '<가구 id>' and state = 'waiting' order by added_at;
update recipe.inbox set state = 'done', recipe_id = '<레시피 id>', handled_at = now() where id = '<대기함 id>';
```

- 부르기 전에 요약을 보여 준다: 제목, 재료 수, 단계 수, 확인이 필요한 곳 수, 어디까지 봤는지.
- `recipe_exists`가 돌아오면 이미 있는 것이다. 덮어쓸지 묻는다.
- 위 네 가지 문장 말고는 Supabase 커넥터로 `recipe` 표를 고치지 않는다(P-04).

대기함에 쓰는 세 문장은 표에 직접 쓰는 것이라 P-04의 예외다. R1 설계에서 `recipe.inbox_add()`, `recipe.inbox_done()` 함수로 감쌀지 정한다.

## claude.ai 스킬 「레시피 담기」 사양

R1에서 DB가 적용된 뒤 claude.ai에서 스킬로 만든다(claude.ai에 "이 사양으로 스킬 만들어 줘"라고 하면 저장 카드가 나온다). 스킬에 들어갈 것:

- **언제**: 요리 영상·글의 주소를 주며 레시피로 담아 달라고 할 때, "레시피 대기함"을 말할 때.
- **순서**: 주소에서 출처 열쇠 만들기 → 이미 있는지 확인 → 읽는 길 고르기 → L0·L1 모으기 → 정리 규칙대로 계약 JSON → 마지막 검사 → 요약 보이기 → 등록 → 결과 한 줄.
- **담을 내용**: 정리 규칙(R-01~R-25) 전문, 계약의 낱말 목록(분류 네 축, 출처 종류), 기준 답안 한 건의 요약, 가구·사람 id, 등록 문장.
- **하지 않을 것**: 숫자 지어내기, 2차 자료의 숫자 쓰기, 자막 원문을 대화나 DB에 길게 옮기기, 표에 직접 쓰기.

스킬은 저장소의 파일을 읽지 못하므로 규칙과 낱말을 스킬 안에 복사해 둔다. 저장소의 규칙이나 계약이 바뀌면 스킬도 고친다. 계약 `contract_version`을 올릴 때 `tracking/status.md`에 "claude.ai 스킬 고치기"를 할 일로 적는다.

## 지금 당장(R1 전) 할 수 있는 것

DB가 없어도 claude.ai에 주소를 주고 "레시피 계약 JSON으로 정리해 줘"라고 하면 초안 파일을 받을 수 있다. 그 파일들은 R2에서 수집 스킬의 시험 자료가 되고, R1 뒤에 한꺼번에 등록한다. 2026-11-18에 만든 스프레드시트(제육볶음)는 같은 내용의 사람이 읽는 판이다.
