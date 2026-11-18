# 레시피: 내용을 가져오는 방법

영상이나 글에서 레시피의 근거를 모으는 도구와 순서다. 장보기의 `data-sources.md`처럼 "확인된 사실"과 "확인 필요"를 나눠 적는다. 확인 필요는 실제로 돌려 본 뒤 이 문서를 고치고 나서 코드를 쓴다.

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

## 확인 필요

| 무엇 | 어떻게 확인 | 언제 |
|---|---|---|
| yt-dlp가 PC(윈도우·맥)에서 유튜브 L0·L1을 받는지, json3 자막의 모양(`events[].tStartMs`, `segs[].utf8`로 알고 있다) | 예시 영상 `AkX6uA4BaDs`로 실행, 결과를 기준 답안과 대조 | R2 |
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
