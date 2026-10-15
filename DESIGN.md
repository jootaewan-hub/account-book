---
version: alpha
name: 우리집 가계부 v2
description: 신혼부부 둘이 쓰는 가계부. 흰 바탕에 귀리색 면으로 묶고, 행동은 먹색, 오늘은 블러시, 포인트는 세이지. SUIT 한 가족과 고정폭 숫자로 금액을 읽기 쉽게 한다.

colors:
  primary: "#33312D"
  on-primary: "#FFFFFF"
  canvas: "#FFFFFF"
  oat: "#F4F1EC"
  oat-deep: "#EAE5DD"
  line: "#ECE8E1"
  ink: "#33312D"
  on-ink: "#FFFFFF"
  ink-muted: "#6B665E"
  ink-faint: "#77726A"
  sage: "#56694E"
  sage-soft: "#E7ECE3"
  sage-ink: "#3F4F39"
  blush: "#E8C4B8"
  blush-soft: "#F6E4DD"
  rose-ink: "#7A3F2E"
  clay: "#A8543E"
  indigo: "#3D5A78"
  who-shared: "#36733A"
  who-child: "#CA9D42"
  who-husband: "#1C588E"
  who-wife: "#C67261"

typography:
  display:
    fontFamily: SUIT
    fontSize: 50px
    fontWeight: 800
    lineHeight: 1
    letterSpacing: -0.035em
    fontFeature: '"tnum" 1'
  amount-lg:
    fontFamily: SUIT
    fontSize: 34px
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: -0.03em
    fontFeature: '"tnum" 1'
  title:
    fontFamily: SUIT
    fontSize: 24px
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: -0.02em
  section:
    fontFamily: SUIT
    fontSize: 17px
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: 0
  body:
    fontFamily: SUIT
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0
  amount:
    fontFamily: SUIT
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: 0
    fontFeature: '"tnum" 1'
  label:
    fontFamily: SUIT
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  meta:
    fontFamily: SUIT
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: 0
  tag:
    fontFamily: SUIT
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  calendar-amount:
    fontFamily: SUIT
    fontSize: 10.5px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0
    fontFeature: '"tnum" 1'

rounded:
  tag: 6px
  inner: 12px
  button: 14px
  sheet-button: 16px
  group: 20px
  sheet: 24px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  gutter: 20px
  lg: 24px
  xl: 32px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.amount}"
    rounded: "{rounded.button}"
    height: 48px
    padding: 0 20px
  button-secondary:
    backgroundColor: "{colors.oat}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    height: 44px
    padding: 0 16px
  record-fab:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.amount}"
    rounded: "{rounded.full}"
    height: 52px
    padding: 0 20px
  chip:
    backgroundColor: "{colors.oat}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 34px
    padding: 0 14px
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 34px
    padding: 0 14px
  platform-tag:
    backgroundColor: "{colors.oat}"
    textColor: "{colors.ink}"
    typography: "{typography.tag}"
    rounded: "{rounded.tag}"
    padding: 1px 6px
  wife-tag:
    backgroundColor: "{colors.blush-soft}"
    textColor: "{colors.rose-ink}"
    typography: "{typography.tag}"
    rounded: "{rounded.tag}"
    padding: 1px 6px
  group-block:
    backgroundColor: "{colors.oat}"
    textColor: "{colors.ink}"
    rounded: "{rounded.group}"
    padding: 16px
  transaction-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: 12px 0
  today-marker:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    size: 28px
  tab-bar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-faint}"
    typography: "{typography.tag}"
    height: 80px
  bottom-sheet:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
  row-meta:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.meta}"
  row-divider:
    backgroundColor: "{colors.line}"
    height: 1px
  group-divider:
    backgroundColor: "{colors.oat-deep}"
    height: 1px
  point-label:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.sage}"
    typography: "{typography.label}"
  category-bar:
    backgroundColor: "{colors.sage}"
    rounded: "{rounded.tag}"
    height: 10px
  selected-soft:
    backgroundColor: "{colors.sage-soft}"
    textColor: "{colors.sage-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
  income-amount:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.indigo}"
    typography: "{typography.amount}"
  holiday-date:
    backgroundColor: "{colors.oat}"
    textColor: "{colors.clay}"
    typography: "{typography.label}"
  who-shared-dot:
    backgroundColor: "{colors.who-shared}"
    rounded: "{rounded.full}"
    size: 8px
  who-child-dot:
    backgroundColor: "{colors.who-child}"
    rounded: "{rounded.full}"
    size: 8px
  who-husband-dot:
    backgroundColor: "{colors.who-husband}"
    rounded: "{rounded.full}"
    size: 8px
  who-wife-dot:
    backgroundColor: "{colors.who-wife}"
    rounded: "{rounded.full}"
    size: 8px
---

# 우리집 가계부 v2

## Overview

신혼부부 두 사람이 사진과 문자로 매일 쓰는 가계부다. 재팬디(쓸모가 먼저, 자연 재료의 색, 단단하지만 둥근 형태)를 화면 규칙으로 옮겼다.

- 흰 바탕 위에 귀리색(`oat`) 면으로 정보를 묶는다. 크림 바탕, 세리프 제목은 쓰지 않는다.
- 행동(버튼, 선택 상태)은 먹색(`ink`) 하나로 통일한다. 세이지는 포인트 글자와 막대 그래프, 블러시는 오늘 표시에만 쓴다.
- 화면마다 크게 쓰는 숫자는 하나뿐이다. 홈은 남은 돈, 고정 지출은 매달 나가는 돈.
- 모든 글자는 한국어 문장형으로 쓴다. 영문 대문자 소제목, 가운데 점으로 이은 정보 문자열은 쓰지 않는다.

### 근거

- Anthropic `frontend-design` 스킬의 "AI 생성 디자인에 몰리는 특징" 목록: 크림 바탕 + 세리프 제목, 자간 넓힌 대문자 소제목, `A · B · C` 정보 문자열, 근접 검정(#111 류), 가는 선 위주 신문형 배치. v1 시안이 이 중 여러 개에 해당했다.
- styleseed(github.com/bitjaru/styleseed) 금융 앱 지침: 색은 절제, 카드 하나에 숫자 하나, 금액은 고정폭 숫자, 돈 숫자는 튀게 움직이지 않음. 한국어는 `word-break: keep-all`, 한글 문장은 13px 이상.
- 토스 TDS, 당근 SEED 공개 토큰: 그림자 대신 면 색으로 깊이를 표현.
- Emil Kowalski 스킬(github.com/emilkowalski/skill, MIT): 움직임 빈도 기준, 곡선·시간, 모바일 웹 기본값. 아래 Motion 절.
- transitions.dev(github.com/jakubantalik/transitions.dev): 숫자 제자리 교체, 토스트, 상태 문장 전환의 값. 우리 앱 안에서 쓰는 것은 허용, 묶음 자체를 재배포하는 것은 금지.
- UI UX Pro Max(github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT): 자동 추천(유리질감, 남색 어두운 바탕, 한글 없는 Caveat 글꼴)은 이 앱에 맞지 않아 쓰지 않았다. 가로 막대에 직접 라벨, 빈 상태 안내, 터치 대상 44pt·간격 8px, `inputmode` 규칙만 가져왔다.
- 형식: google-labs-code/design.md 명세(alpha). `npx @google/design.md lint` 오류 0, 경고 0.

## Colors

| 토큰 | 값 | 역할 | 흰 바탕 대비 |
|---|---|---|---|
| `canvas` | #FFFFFF | 화면 바탕 | |
| `oat` | #F4F1EC | 묶음 면, 태그, 보조 버튼, 칩 | |
| `oat-deep` | #EAE5DD | 묶음 안 구분선, 차트 바닥선 | |
| `line` | #ECE8E1 | 목록 행 구분선, 탭 바 윗선 | |
| `ink` | #33312D | 본문, 주 버튼, 선택된 칩 | 12.98:1 |
| `ink-muted` | #6B665E | 보조 글자 | 5.70:1 (귀리 위 5.06:1) |
| `ink-faint` | #77726A | 꺼진 탭 | 4.77:1 |
| `sage` | #56694E | 포인트 글자, 분류 막대 | 5.96:1 (흰 글자 올림 5.96:1) |
| `blush` | #E8C4B8 | 오늘 날짜 원 | 먹 글자 8.05:1 |
| `clay` | #A8543E | 일요일, 공휴일, 늘어난 항목 | 5.25:1 |
| `indigo` | #3D5A78 | 들어온 돈, 토요일 | 7.16:1 |

**누구 표시 4색** (`who-*`)은 dataviz 검증기(`validate_palette.js`)를 통과한 값이다. 명도대, 채도 하한, 색약 구분(최소 ΔE 17.9), 일반 시각 구분(최소 ΔE 25.1) 모두 통과. 단 **공동 → 자녀 → 남편 →아내** 순서로 붙여 놓을 때만 통과한다(아내와 자녀, 공동과 아내가 이웃하면 실패). 자녀 색(#CA9D42)은 흰 바탕 대비 2.43:1이라 항상 이름 글자와 함께 쓴다.

지출 금액은 먹색으로 쓴다. 빨간 계열을 지출 전체에 칠하지 않는다. 들어온 돈만 쪽빛과 `+`를 붙인다.

## Typography

글꼴은 **SUIT 2.0.5** 한 가족이다(OFL-1.1, 한글 11,172자 전부, 가변 woff2 625KB). Pretendard(라틴이 Inter 기반이고 AI 생성 앱의 기본값)와 Wanted Sans(가변 1.29MB)를 같은 화면에 렌더링해 비교한 뒤 골랐다. 굵기로 위계를 나누고, 금액에는 `font-variant-numeric: tabular-nums`를 건다.

- `display` 50/800: 화면당 한 번, 홈의 남은 돈.
- `title` 24/800: 화면 제목. `section` 17/700: 묶음 제목(날짜 등).
- `body` 16/500, `amount` 16/700: 목록 행.
- `meta` 13/500: 보조 정보. 한글 문장은 13px 아래로 내리지 않는다.
- `tag` 12/600: 플랫폼, 사람 태그(두세 글자).
- `calendar-amount` 10.5/600: 달력 칸 금액. 숫자만 쓴다.

## Layout

- 모바일 390px 기준, 좌우 여백 20px, 묶음 면은 화면 끝에서 12px 안쪽.
- 간격은 4의 배수만 쓴다. 묶음 사이 24px, 묶음 안 행 사이는 선 하나.
- 홈: 남은 돈 → 쓴 돈 막대 → 달력(귀리 면) → 고른 날의 내역 → 오른쪽 아래 "기록하기" 버튼.
- 아래 탭 5개(달력, 내역, 통계, 고정, 설정), 높이 80px, 켜진 탭만 먹색과 굵은 글자.

## Elevation & Depth

그림자를 쓰지 않는다. 깊이는 면 색 차이(흰색 위 귀리)와 바텀시트 뒤 어두운 막(`rgba(51, 49, 45, 0.42)`)으로만 표현한다.

## Shapes

| 역할 | 반경 |
|---|---|
| 태그 | 6px |
| 사진 썸네일, 로고 타일 | 10–12px |
| 버튼 | 14px (시트 하단 큰 버튼 16px) |
| 묶음 면 | 20px |
| 바텀시트 윗모서리 | 24px |
| 칩, 기록하기 버튼 | 완전한 반원 |

아이콘은 24 격자, 선 두께 1.75px(켜진 탭 2.1px), 둥근 끝. 이모지를 아이콘 대신 쓰지 않는다.

## Components

- **기록하기 시트**: "사진으로 기록하기"를 가장 크게(귀리 면, 사진 20장까지), 문자 붙여넣기와 관리비 고지서는 그 아래 보조 버튼 두 개. 직접 입력은 그 다음. 저장 버튼은 금액을 넣어 "12,900원 저장하기"처럼 쓴다.
- **내역 행**: 첫 줄 상품명(`body`), 둘째 줄 플랫폼 태그 + 사람 태그(공동이 아닐 때만) + 쉼표로 이은 보조 정보(`meta`), 오른쪽 금액(`amount`). 행마다 아이콘 타일을 붙이지 않는다. 구독만 실제 서비스 로고를 붙인다.
- **칩**: 기본은 귀리 면, 선택되면 먹색 면에 흰 글자. 사람 칩에는 8px 색 점을 앞에 붙인다.
- **관리비 묶음**: 금액, 지난달·작년 대비 문장 두 개, 사용량 표(이번 달, 지난달 %, 작년 %). 줄어든 값은 세이지 진한색, 늘어난 값은 흙빛.
- **차트**: 크기 비교는 세이지 한 색. 진행 중인 달은 빗금. 숫자는 막대 옆에 직접 쓰고 범례 상자를 따로 두지 않는다. 사람별 비율 막대는 2px 틈을 두고 위 순서로 놓는다.
- **상태**: 목록, 통계, 관리비는 빈 상태·불러오는 중·오류 문구를 각각 둔다(예: "이번 달 기록이 아직 없어요. 사진 한 장으로 시작해 보세요.").

## Motion

근거: Emil Kowalski `emil-design-eng`·`mobile-native`·`apple-design`(MIT), transitions.dev(무료 사용, 라이브러리 재배포 금지), styleseed 금융 앱 지침. 원칙은 "자주 쓰는 동작일수록 덜 움직이고, 돈 숫자는 튀지 않는다"이다.

**토큰**

| 이름 | 값 | 쓰는 곳 |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | 나타나기·사라지기, 누름 반응 |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | 바텀시트 (iOS 시트 곡선) |
| `--ease-smooth` | `cubic-bezier(0.22, 1, 0.36, 1)` | 토스트, 달 넘김, 탭 알약 |
| `--dur-press` | `160ms` | 버튼 누름 |
| `--dur-swap` | `200ms` | 숫자 바꿔 끼우기 |
| `--dur-quick` | `250ms` | 시트·토스트 닫기, 달 넘김 |
| `--dur-sheet` | `400ms` | 시트 열기 |

**어디를 움직이나** (Emil의 빈도 기준: 하루 수십 번이면 줄이거나 없앤다)

| 상황 | 하루 빈도 | 움직임 |
|---|---|---|
| 아래 탭 전환 | 수십 번 | 없음. 색과 굵기만 바뀐다 |
| 버튼·칩 누름 | 수십 번 | `:active`에서 `scale(0.97)`, 160ms. 손을 대는 순간 반응 |
| 달 넘김(‹ ›) | 몇 번 | 달력은 넘긴 방향으로 8px 밀리며 흐림 3px→0, 250ms. 남은 돈 같은 숫자는 제자리에서 흐림 교차(transitions.dev text-swap-soft), 200ms, 위치 이동 없음 |
| 기록하기 시트 | 몇 번 | `translateY(100%)`→0, 400ms `--ease-drawer`. 닫기는 250ms로 더 빠르게. 뒤 막은 투명도만. 끌어 내려 닫기는 속도 0.11px/ms 넘으면 거리와 상관없이 닫고, 닫기 버튼은 항상 둔다(WCAG 2.2 끌기 대안) |
| 저장 완료 토스트 | 몇 번 | 아래서 16px 올라오며 흐림 2px→0, 열기 350ms, 닫기 250ms |
| 사진 분석 대기(12–17초) | 몇 번 | 상태 문장 한 줄이 반짝임(shimmer)으로 살아 있고, **실제 단계가 바뀔 때만** 문장을 바꾼다("사진 3장 올리는 중" → "2묶음 중 1묶음 읽었어요"). 지어낸 진행률은 쓰지 않는다 |
| 목록 처음 불러오기 | 가끔 | 자리 표시 후 흐림 교차로 내용 등장, 400ms |
| 금액 입력 오류 | 드묾 | 입력칸 좌우 6px 흔들림 + 오류 문장(색만으로 알리지 않음) |

**하지 않는 것**: 금액 숫자 굴리기(odometer)·튀어 오르기, 화면 들어올 때마다 위로 떠오르기(fade-and-slide), `transition: all`, `scale(0)`에서 시작, `ease-in`, 손가락 터치 기기의 hover 효과.

**접근성**: `prefers-reduced-motion: reduce`이면 이동·크기 변화를 빼고 투명도 교차만 남긴다.

**모바일 기본값** (Emil `mobile-native`):

- `html`에 `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`; 시트 안쪽은 `overscroll-behavior: contain`.
- 버튼·탭·칩에 `touch-action: manipulation`, `user-select: none`. 본문 글자는 선택 가능하게 둔다.
- 입력칸 글자는 16px 이상(iOS 확대 방지). 금액 칸은 `inputmode="numeric"`.
- hover 규칙은 `@media (hover: hover) and (pointer: fine)` 안에만.
- 앱 높이는 `100dvh`, 아래 탭·시트는 `env(safe-area-inset-bottom)`만큼 띄운다.
- `theme-color`는 화면 맨 위 색(#FFFFFF)과 맞춘다.

## Do's and Don'ts

| 해요 | 하지 않아요 |
|---|---|
| 흰 바탕 + 귀리 면으로 묶기 | 크림 바탕 전체 깔기, 세리프 제목 |
| 한국어 문장형 제목("어디에 썼나") | 영문 대문자 소제목(OUR HOME, INSIGHT) |
| 플랫폼은 태그, 나머지는 쉼표 | `공동 · 쿠팡 · 장보기` 같은 점 이은 문자열 |
| 금액은 고정폭 숫자, 화면당 큰 숫자 하나 | 모든 카드에 큰 숫자, 금액 숫자 애니메이션 |
| 주 버튼은 먹색, 이름에 결과("3장 분석하기") | "확인", "제출" 같은 버튼 이름 |
| 사람 색은 검증된 순서 + 이름과 함께 | 색만으로 누구인지 표시 |
| 묶음은 면 색으로 | 같은 그림자의 카드 벽, 행마다 아이콘 타일 |
