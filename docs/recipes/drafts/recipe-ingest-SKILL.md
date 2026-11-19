---
name: recipe-ingest
description: 요리 영상·글의 주소(유튜브, 쇼츠, 인스타 릴스, 블로그)나 파일에서 재료와 순서를 읽어 레시피 계약 JSON으로 정리하고 초안으로 등록한다. "레시피 담아 줘", "이 영상 레시피로", "레시피 대기함 처리"라고 하거나 /recipe-ingest <주소>로 부를 때 쓴다.
---

> **낡음(2026-11-19).** 설계 승인으로 쓰지 않게 된 초안이다. 읽기는 맥 처리기(`tools/recipe-worker/`)가 하고(D-057), 이 초안의 "PC의 Claude Code가 읽고 Supabase MCP로 등록한다"는 흐름은 맞지 않다. 계약도 v1이라 낡았다(지금은 v2, `supabase/functions/_shared/recipeContract.ts`). 본문은 그때의 생각을 남겨 둔 것이다.

# 레시피 담기 (Claude Code)

초안이다. R2에서 실제로 돌려 보며 고친다. 명령의 결과 모양이 아래와 다르면 멈추고 `docs/recipes/ingest-sources.md`의 "확인 필요"를 먼저 고친다.

먼저 읽는다: `docs/recipes/extraction-rules.md`(정리 규칙 R-01~R-25), `docs/recipes/contract/recipe.schema.json`(계약), `docs/recipes/ingest-sources.md`(수집 단계).

## 지킬 것

- 숫자는 출처에 있는 것만. 없으면 비운다. 덧붙임은 `suggested_*`, `editor_tip`에만.
- 내려받은 것과 자막 원문은 `.recipe-cache/<열쇠>/`에만 둔다. 저장소와 DB에 넣지 않는다. 영상·음성은 끝나면 지운다.
- 받지 못하면 우회하지 않는다. 쿠키가 필요하면 사용자에게 묻는다. 본계정 쿠키는 쓰지 않는다.
- 등록은 `recipe.import_recipe()`로만. 부르기 전에 요약을 보여 준다.
- 한 번에 영상 하나씩. 대기함을 처리할 때도 차례로.

## 순서

### 0. 준비

- 인자가 주소면 그 주소, "대기함"이면 Supabase MCP로 `recipe.inbox`의 `waiting`을 읽어 차례로.
- 출처 열쇠를 만든다: `youtube:<id>`(쇼츠도 같은 id), `instagram:<shortcode>`, `web:<주소의 sha1 앞 16자>`. 폴더 `.recipe-cache/<열쇠에서 :를 -로>/`.
- 이미 등록됐는지 본다: `select id, status from recipe.recipes where household_id = '<가구>' and source_key = '<열쇠>'`. 있으면 다시 읽을지 묻는다.
- `yt-dlp -U`로 최신인지 확인한다(일주일에 한 번이면 된다).
- 가구 id와 내 id는 `.env.local`의 `RECIPE_HOUSEHOLD_ID`, `RECIPE_USER_ID`에서 읽는다. 없으면 `docs/recipes/claude-ai-workflow.md`의 첫 문장으로 찾아 사용자에게 `.env.local`에 넣어 달라고 한다(저장소에 적지 않는다).

### 1. L0 글

```bash
yt-dlp -J --skip-download --no-playlist "<주소>" > .recipe-cache/<폴더>/meta.json
```

`title`, `channel`, `upload_date`, `duration`, `description`, `chapters`를 읽는다. 설명란에 재료·분량·순서가 있는지 본다. 블로그는 WebFetch로 본문을 읽는다.

### 2. L1 자막 (L0와 늘 같이)

```bash
yt-dlp --skip-download --no-playlist --write-subs --write-auto-subs \
       --sub-langs "ko.*,ko" --sub-format json3 -P .recipe-cache/<폴더> -o "subs" "<주소>"
```

작성자 자막이 있으면 그것(`caption_manual`), 없으면 자동 자막(`caption_auto`). 시작 시각(초)과 말의 줄로 바꾼다. 자막이 없으면 3으로.

### 3. 충분한가

- 필수 재료마다 숫자 분량이나 원래 표현이 있는가.
- 단계가 순서대로 이어지고, 재료가 모두 어느 단계에선가 쓰이는가.

충분하면 5로. 아니면 모자란 것만 채우러 4로.

### 4. 필요할 때만

**L2 받아쓰기** (자막이 없을 때)

```bash
yt-dlp --no-playlist -f "bestaudio/best" -x --audio-format m4a -P .recipe-cache/<폴더> -o "audio.%(ext)s" "<주소>"
```
```python
from faster_whisper import WhisperModel
model = WhisperModel("large-v3-turbo", device="auto")
segments, info = model.transcribe("audio.m4a", language="ko", vad_filter=True,
                                  initial_prompt="요리 영상. 재료: <설명란에서 뽑은 재료 이름>")
```
출처는 `asr`.

**L3 화면** (분량이 화면에만 있을 때)

```bash
yt-dlp --no-playlist -f "bv*[height<=720]+ba/b[height<=720]" -P .recipe-cache/<폴더> -o "video.%(ext)s" "<주소>"
ffmpeg -ss <초> -i video.mp4 -frames:v 1 -q:v 3 .recipe-cache/<폴더>/frames/<초>.jpg   # 재료가 언급된 시각마다
ffmpeg -i video.mp4 -vf fps=1/2 -q:v 3 .recipe-cache/<폴더>/frames/%03d.jpg           # 쇼츠·릴스
```
장면을 Read로 읽는다. 20장까지. 출처는 `screen`.

**L4 대조** (그래도 빈 곳이 있을 때)

WebSearch로 같은 레시피를 정리한 글을 찾아 대조만 한다. 숫자를 가져오지 않는다. 빈 곳은 `gaps`에 적는다.

**파일로 받은 경우** (릴스 저장 파일, 화면 녹화)

사용자가 준 파일을 `.recipe-cache/<폴더>/`에 복사해 L2·L3부터 한다. 게시글 본문을 함께 받았으면 L0로 쓴다(출처 `description`).

### 5. 정리

`extraction-rules.md`대로 계약 JSON을 `.recipe-cache/<폴더>/recipe.json`에 쓴다. 특히:

- 설명란이 적은 것은 그 값(R-02), 말과 다르면 `conflicts`(R-04).
- 흐리게 들린 것은 넣고 `needs_review`(R-05).
- 단계마다 `video_start_seconds`(R-18), 넘어가는 신호는 `cue`(R-17).
- 나눠 넣는 재료는 `uses.portion`(R-14).
- 고친 낱말은 `extraction.corrections`(R-24), 어디까지 봤는지는 `levels`와 `not_checked`(R-08).
- `extracted_by`는 `Claude Code recipe-ingest`.

### 6. 검사

1. 계약 통과(R2에서 `scripts/validate.mjs`로 만든다. 그 전에는 예시 JSON과 눈으로 대조).
2. 단계의 `uses[].name`이 모두 재료 목록에 있다.
3. 필수 재료가 모두 어느 단계에선가 쓰인다.
4. 숫자가 있는 줄의 출처가 `secondary`·`editor`가 아니다.
5. 본문에 자막을 길게 옮긴 문장이 없다.

### 7. 요약을 보이고 등록

```
제목: 기사식당 바싹 제육볶음 (셰프호윤, 2025-06-03)
재료 17 · 단계 12 · 원리 5
확인 필요 5: 통깨(흐리게 들림), 단맛 총량 비율, 설명란과 영상 말이 다른 곳 3
본 것: 설명란, 자동 자막 / 안 본 것: 화면 글자
```

사용자가 좋다고 하면:

```sql
select recipe.import_recipe('<가구 id>', '<내 id>', $recipe$ …recipe.json 내용… $recipe$::jsonb);
```

대기함에서 온 것이면 `state = 'done'`, `recipe_id`, `handled_at`을 채운다. 빈 곳이 남았으면 `needs_more`.

### 8. 치우기

`.recipe-cache/<폴더>/`에서 `audio.*`, `video.*`, `frames/`를 지운다. `meta.json`, 자막, `recipe.json`은 다시 볼 일이 있으면 남겨도 된다(저장소에 들어가지 않는다).

## 막혔을 때

| 일 | 할 것 |
|---|---|
| yt-dlp가 받지 못한다 | `yt-dlp -U` 뒤 한 번 더. 그래도 안 되면 사용자에게 알리고, 브라우저로 스크립트 패널을 읽을지(Playwright MCP) 묻는다 |
| 로그인이 필요하다고 한다 | 멈추고 묻는다. 파일로 넣기를 권한다 |
| 자막도 말도 없다 | L3로. 그래도 없으면 등록하지 않고 대기함을 `failed`로, 까닭을 적는다 |
| 요리 영상이 아니다 | 등록하지 않는다 |
| `recipe_exists` | 덮어쓸지 묻고 네 번째 인자를 `true`로 |

## 기준 답안

`docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json`. 스킬을 고치면 이 영상으로 다시 돌려 대조한다(재료 15가지의 숫자, 대파·깻잎 나눠 넣기, 충돌 세 군데, 단계 시각 ±15초).
