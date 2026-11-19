# 레시피: 내용을 가져오는 방법

영상이나 글에서 레시피의 근거를 모으는 도구와 순서다. 장보기의 `data-sources.md`처럼 "확인된 사실"과 "확인 필요"를 나눠 적는다. 확인 필요는 실제로 돌려 본 뒤 이 문서를 고치고 나서 코드를 쓴다.

> **2026-11-19 설계 반영.** 첫 판은 유튜브 영상·쇼츠만 읽고, 2차 자료(L4)·인스타·Gemini는 뺐다(D-063). 읽는 곳은 집 맥의 처리기이고 도구는 yt-dlp·Deno, 한국어 자막, whisper.cpp 받아쓰기, 1초 한 장 장면과 macOS 글자 인식이다(D-057). 아래 "확인 필요"는 실제 영상으로 확인하기 전(승인 대기 중인 Task 14, `tracking/status.md`)이라 그대로 남아 있다. 확인한 뒤 이 문서를 고친다.

## 수집 단계 (앞에서 충분하면 멈춘다)

| 단계 | 모으는 것 | 얻는 근거 | 언제 다음으로 가나 |
|---|---|---|---|
| **L0** 글 | 제목, 채널, 올린 날, 길이, **설명란**(인스타는 게시글 본문), 챕터, 고정 댓글 | 작성자가 직접 쓴 재료·분량·순서 | 재료 목록이나 분량이 없거나 부족할 때 |
| **L1** 자막 | 작성자 자막 → 없으면 자동 자막(시각 포함) | 실제 순서, 불 세기, 넘어가는 신호, 요령, 단계별 시각 | 자막이 없거나, 분량이 말로도 안 나올 때 |
| **L2** 받아쓰기 | 음성을 받아 PC에서 받아쓰기 | 자막 없는 쇼츠·릴스의 말 | 말이 없거나, 분량이 화면에만 있을 때 |
| **L3** 화면 | 재료가 나오는 시각의 장면 몇 장, 또는 영상 전체 이해 | 화면 글자("간장 3T"), 손동작으로만 보이는 것 | 그래도 빈 곳이 있을 때 |
| **L4** 2차 자료 | 같은 레시피를 정리한 기사·블로그 | 대조용. **숫자의 출처로 쓰지 않는다** | 여기가 끝. 남은 빈 곳은 `gaps`로 |

충분하다고 보는 기준: 필수 재료마다 숫자 분량이나 원래의 분량 표현이 있고, 단계가 순서대로 이어지며, 재료가 모두 어느 단계에선가 쓰인다. 하나라도 빠지면 다음 단계로 간다.

세 도우미 비교(`benchmark/2026-11-18-three-assistants.md`)에서 본 것: L1만 본 쪽은 설탕 분량을 놓쳤고, L0와 L1을 같이 본 쪽은 놓치지 않았다. **L0와 L1은 늘 같이 본다.**

## 출처 종류별

| 출처 | L0 | L1 | L2 | L3 | 메모 |
|---|---|---|---|---|---|
| 유튜브 | 설명란에 레시피가 있는 채널이 많다 | 자동 자막이 대개 있다 | 드물게 필요 | 화면 자막 위주 채널에서 필요 | |
| 유튜브 쇼츠 | 설명란이 짧다. 고정 댓글에 레시피를 두기도 한다 | 없는 경우가 있다(추측입니다) | 자주 필요 | 자주 필요(화면 글자) | 주소 `/shorts/<id>`는 같은 id의 일반 영상이다 |
| 인스타 릴스 | **게시글 본문**이 가장 중요하다 | 없다고 본다 | 필요 | 필요 | 로그인 문제. 아래 "인스타그램" |
| 블로그·웹 | 본문 | — | — | 사진 속 글자 | 출처 종류 `page` |
| 요리책·메모 사진 | 사진 | — | — | — | 사진을 바로 읽는다 |
| 직접 쓰기 | — | — | — | — | 출처 `user` |

## 도구: 확인된 사실

2026-11-18, claude.ai 작업 환경(리눅스)에서 설치하고 옵션을 확인했다. 실제 영상 받기는 확인하지 못했다(그 환경은 영상 사이트에 접속할 수 없다).

### yt-dlp (2026.10.26)

- 있는 옵션: `-J/--dump-single-json`, `--skip-download`, `--no-playlist`, `--write-subs`, `--write-auto-subs`, `--sub-langs`, `--sub-format`, `--convert-subs`, `-x/--extract-audio`, `--audio-format`, `-f`, `-o`, `-P`, `--write-info-json`, `--write-comments`, `--download-sections`, `--cookies`, `--cookies-from-browser`.
- 추출기 목록에 `youtube`, `Instagram`, `TikTok`, `Naver`가 있다.
- 2026년에 명령 주입 취약점(CVE-2026-55404, `--write-link` 관련)이 고쳐졌다. 쓰기 전에 최신으로 올린다. `--write-link`는 쓰지 않는다.

쓸 명령(첫 실행 때 결과 모양을 확인하고 이 문서에 적는다):

```bash
# L0: 글만. 영상은 받지 않는다
yt-dlp -J --skip-download --no-playlist "<주소>" > .recipe-cache/<열쇠>/meta.json
#   쓰는 칸: id, title, channel, upload_date, duration, description, chapters, subtitles, automatic_captions

# L0 보충: 고정 댓글이 필요할 때만
yt-dlp -J --skip-download --no-playlist --write-comments "<주소>" > .recipe-cache/<열쇠>/meta-comments.json

# L1: 자막만. 작성자 자막이 있으면 그것, 없으면 자동 자막
yt-dlp --skip-download --no-playlist --write-subs --write-auto-subs \
       --sub-langs "ko.*,ko" --sub-format json3 -P .recipe-cache/<열쇠> -o "subs" "<주소>"

# L2: 음성만
yt-dlp --no-playlist -f "bestaudio/best" -x --audio-format m4a -P .recipe-cache/<열쇠> -o "audio.%(ext)s" "<주소>"

# L3: 낮은 화질 영상(장면용)
yt-dlp --no-playlist -f "bv*[height<=720]+ba/b[height<=720]" -P .recipe-cache/<열쇠> -o "video.%(ext)s" "<주소>"
```

### faster-whisper (1.2.1)

- `WhisperModel(model, device="auto", compute_type="default")`, `transcribe(..., language, vad_filter, initial_prompt, hotwords, word_timestamps, beam_size)`가 있다.
- 모델 이름에 `large-v3`, `large-v3-turbo`(`turbo`), `distil-large-v3.5`가 있다.
- MIT 라이선스, 공식 명령줄 도구는 없고 파이썬에서 부른다.

```python
from faster_whisper import WhisperModel
model = WhisperModel("large-v3-turbo", device="auto")
segments, info = model.transcribe(
    "audio.m4a", language="ko", vad_filter=True,
    initial_prompt="요리 영상. 재료: " + ", ".join(설명란에서_뽑은_재료_이름),  # 받아쓰기 오류를 줄인다
)
rows = [{"start": round(s.start), "text": s.text.strip()} for s in segments]
```

### ffmpeg

```bash
# 정한 시각의 한 장면(재료가 언급된 시각 ± 2초)
ffmpeg -ss <초> -i video.mp4 -frames:v 1 -q:v 3 .recipe-cache/<열쇠>/frames/<초>.jpg
# 쇼츠·릴스: 2초에 한 장
ffmpeg -i video.mp4 -vf fps=1/2 -q:v 3 .recipe-cache/<열쇠>/frames/%03d.jpg
```

장면은 Claude Code가 이미지로 읽는다. 한 영상에 20장을 넘기지 않는다.

### 유튜브 공식 API

- 설명란·제목은 공식 Data API로 받을 수 있다.
- 자막 내려받기(`captions.download`)는 그 영상을 편집할 권한이 있는 사용자만 된다. 남의 영상 자막은 공식 API로 받을 수 없다. (Google 문서, 2026-11-18 확인)

### Gemini API의 영상 이해 (선택, L3)

Google 문서(2026-11-18 확인) 기준:

- 유튜브 주소를 요청에 직접 넣을 수 있다. 공개 영상만 된다(비공개·일부 공개 불가).
- 무료 등급은 하루에 유튜브 영상 8시간까지.
- 기본은 1초에 한 장면을 뽑아 본다. 소리와 화면을 함께 본다.
- 유튜브가 아닌 영상(릴스)은 파일을 올려야 한다.

화면 글자가 많은 영상에서 장면 20장보다 나을 수 있다. 별도 키와 비용이 든다(P-07).

### claude.ai에서 쓰는 길

- **내장 브라우저**(Claude 데스크톱 앱): 2026-11-18에 이 방식으로 설명란 전체와 스크립트 패널(자동 자막, 시각 포함)을 읽었다. 그 컴퓨터에서 데스크톱 앱이 켜져 있어야 한다.
- **YouTube Transcriber 플러그인**: 켜져 있다. 브라우저에서 스크립트 패널을 여는 같은 방식이다.
- **claude.ai의 웹 읽기 도구**: 같은 날 유튜브 주소를 두 번 읽으려 했으나 실패했다(요청 제한 한 번, 접속 오류 한 번).
- **Firecrawl**: ChatGPT가 같은 영상에서 설명란과 자동 자막(시각 포함)을 이것으로 읽었다고 했다. Firecrawl 문서에 따르면 유튜브 주소를 읽으면 자막이 있을 때 본문 마크다운에 자막이 들어오고, v2.3.0에서 유튜브 지원이 들어갔다. API 키가 필요하다.

### 맥 처리기로 돌린 실제 영상 (Task 14, 2026-11-19 저녁, 집 인터넷, 맥)

처리기의 건조 실행(`node tools/recipe-worker/src/cli.ts dry-run`)으로 4개 영상을 5번 돌렸다. 결과 파일과 기록은 `.recipe-cache/`(저장소에 넣지 않음)에만 있다. 도구: yt-dlp 2026.10.26, deno 2.9.8, whisper `large-v3-turbo`, claude CLI(모델 설정 없음 = 기본 모델, 응답의 `modelUsage`는 `claude-opus-5-5`).

- yt-dlp 2026.10.26 + deno 2.9.8로 유튜브 영상 정보·설명란·자동 자막·720p 영상 받기가 5번(`AkX6uA4BaDs`, `wruh__UmGaU`, `FgKy9Xq4LKY` 두 번, `k57yoXtPYRA`) 모두 오류 없이 됐다. 회사 인터넷은 아직 확인하지 않았다(확인 필요, 평일 낮).
- 기준 답안 영상: 재료 숫자 12개 모두 기준과 같고(빠뜨림 0), 어느 출처에도 없는 숫자 0. 단계 시각은 최대 5초 차(±15초 안 12/12). 불 세기·양념장 양 "다른 곳" 2/3 맞힘, 통깨는 화면 글자에서 읽혀 다른 곳으로 나오지 않았다. 걸린 시간 265초(영상 13분 13초).
  - 설계의 "재료 숫자 15개"와 12개가 다른 까닭(기준 답안 파일 `contract/examples/youtube-AkX6uA4BaDs.json`을 세어 봄): 파일의 재료는 17줄이고 출처 숫자(`amount`)가 있는 줄은 12줄이다. 타이머는 0개, 출처 인분은 없다(`servings.value` null). 출처 숫자가 아닌 덧붙인 숫자가 3개(깻잎 `suggested` 8장, 참기름 `suggested` 1작은술, 인분 `suggested` 2) 더 있어 모두 15개다. 설계의 15는 덧붙임까지 센 수로 보인다(추측입니다: 설계에 세는 법이 적혀 있지 않다). V1 검사는 출처 숫자만 보므로 판정은 12개로 한다. Task 14 결과 글의 "12 + 약간류 3개(후추·깻잎·참기름)"는 파일과 다르다: "약간"인 줄은 후추·깻잎·참기름·미림(추가분) 넷이다.
- 간장두부조림(19분 29초) 265초, 쇼츠 141~216초. 이때는 긴 영상의 화면 글자 약 15,000자(영상 앞쪽 6~7분)와 장면 24장까지만 봤다(`not_checked`: "07:00 이후 잘림", "06:44 이후 잘림"). 같은 날 처리기를 고쳐 한도는 그대로 두되 영상 전체에서 고르게 고른다(R2, `architecture.md`). 고친 뒤 실제 영상으로 다시 돌려 보지는 않았다(확인 필요).
- 설명란을 숨긴 쇼츠(`FgKy9Xq4LKY --no-description`)에서 화면 글자로 읽은 분량 5개가 설명란 값과 모두 같았다(단위는 빠짐). 설명란이 빈 쇼츠(`wruh__UmGaU`)는 화면에 분량표가 없어(구운 자막·포장지 글자뿐) 분량을 지어내지 않고 `gaps`에 적었다. 단위가 빠진 분량은 같은 날 확인 필요 "단위를 읽지 못했어요"로 올리게 고쳤다(R3, `extraction-rules.md`).
- 기준 답안 실행의 계량 도구는 "밥숟가락"(근거로 화면 254초·293초를 달았다)이었고 기준 답안은 "확인 못 함"이다. 같은 날 도구의 말이 근거 글에 없으면 "확인 못 함"으로 바꾸게 고쳤다(M9).
- `claude -p`가 구독 로그인으로 헤드리스 실행되고, `Read(//절대경로/**)` 허락 규칙으로 작업 폴더의 장면 그림(PNG)을 읽는다. 오류는 종료 코드 0·JSON `is_error:true`(예: 없는 모델 → `api_error_status:404`)로 온다. 이 실행들에서는 처리기가 사용량을 버리고 있어 레시피 하나의 사용량을 재지 못했다(작은 호출 하나가 정가 기준 약 $0.13, 시스템 프롬프트 약 3.5만 토큰). 사용량 제한 오류 글의 실제 모양은 만나지 못했다(확인 필요).
- 같은 날 처리기를 고쳐 호출마다 사용량을 받아 일마다 합한다(R1). 또 `claude -p`가 사용자 설정·CLAUDE.md·스킬·훅을 물려받지 않게 했다(I4, `architecture.md`). 같은 작은 호출(파일 두 개 읽기, 3턴)로 재 보니 입력이 캐시 포함 20,798 토큰에서 7,776 토큰으로, 정가 기준 금액이 $0.0797에서 $0.0268로 줄었다. 환경에 `USER`가 없으면 CLI가 구독 로그인을 찾지 못했다(`claude auth status`가 `loggedIn: false`). 처리기는 없으면 채운다. launchd로 돌 때는 아직 확인하지 않았다(확인 필요, Task 23·25).
- 이용 조건: 공식 문서(https://code.claude.com/docs/en/legal-and-compliance)는 Pro/Max 한도가 "ordinary, individual usage"를 전제한다고 하고 서비스 개발은 API 키를 쓰라고 한다. 사람 없이 정기적으로 도는 개인 일괄 작업이 이에 해당하는지는 문서에 없다(**확인 필요: 사용자 판단**). `claude -p`·Agent SDK를 별도 크레딧으로 돌린다는 정책은 비공식 글에만 있다(확인 필요).
- Google OAuth "Testing" 상태 갱신 토큰은 7일 만료(https://developers.google.com/identity/protocols/oauth2). `drive.file`은 비민감 범위로 Sheets 범위 목록에 있으나(https://developers.google.com/workspace/sheets/api/scopes), 앱이 만든 시트에 Sheets API가 되는지는 직접 문장이 없다(확인 필요, Task 25에서 시도).

## 확인 필요

| 무엇 | 어떻게 확인 | 언제 |
|---|---|---|
| 회사 인터넷에서 유튜브 받기(A1). 집 인터넷은 2026-11-19에 확인 | 예시 영상 `AkX6uA4BaDs`로 건조 실행 | 평일 낮 |
| launchd로 도는 처리기가 `claude -p`를 구독 로그인으로 부르는지(A2) | 설치 뒤 처리기 기록(`err.log`)의 일 한 줄과 사용량 | Task 25 |
| 고친 뒤(화면 글자·장면을 영상 전체에서 고름) 긴 영상의 뒤쪽 근거를 보는지 | `k57yoXtPYRA` 건조 실행의 `not_checked`와 화면 출처 숫자 | 다음 실제 시험 |
| 쇼츠의 자막 유무 비율 | 실제로 담고 싶은 쇼츠 10개로 | R6 |
| 인스타 릴스: 로그인 없이 본문·영상이 받아지는지 | 공개 릴스 3개로 L0만 먼저 | R6 |
| 받아쓰기 속도: PC에 그래픽카드가 있는지, 10분 영상에 몇 분 걸리는지 | `large-v3-turbo`와 `small` 비교 | R6 |
| 유튜브 고정 댓글이 `--write-comments`로 구분돼 나오는지 | 고정 댓글에 레시피를 둔 영상 1개 | R6 |
| TubeAlfred 플러그인, 자막 MCP 서버(kimtaeyoon83, hancengiz 등)의 실제 동작과 한도 | 쓰기로 정하면 그때 | P-08 |
| Gemini API 요금과 한국어 화면 글자 읽기 품질 | 화면 자막 위주 영상 3개 | R6, P-07 |

## 인스타그램

- 공개 자료에서는 말이 엇갈린다. yt-dlp로 릴스를 받으려면 로그인 쿠키가 꼭 필요하다는 글이 많고, 공개 릴스의 글 정보는 로그인 없이 된다는 글도 있다. 직접 확인한다.
- 본계정 쿠키는 쓰지 않는다. 쿠키는 계정 열쇠와 같고, 자동 접근으로 계정이 제한될 수 있다. 쓰더라도 따로 만든 계정의 쿠키를 저장소 밖에 둔다(P-09).
- 공개 스킬 모음의 한 인스타 릴스 스킬은 보안 점검에서 위험 '높음' 판정을 받았다(관리되지 않는 설치, 브라우저 쿠키 사용). 밖에서 가져온 스킬은 내용을 읽고 쓴다.
- 늘 되는 길을 하나 둔다: **파일로 넣기.** 휴대폰에서 릴스를 저장하거나 화면 녹화한 파일과 게시글 본문을 건네면 L2·L3로 읽는다. 사이트에 접근하지 않는다.

## 쓰지 않는 것

- 서버(Edge Function)에서 영상 사이트 읽기. 막히기 쉽고 앱 운영에 비공식 접근이 묻는다.
- 유료 자막 API 서비스. 두 사람이 쓰는 양에는 필요 없다.
