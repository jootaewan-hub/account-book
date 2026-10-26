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

장보기 탭(2026-10-19 통합, D-010)의 늘어난 규칙(경고 배지, 출처 태그, 시세 등락, 상품 이미지 타일)은 `docs/grocery/DESIGN.md`에 있다.

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

귀리 면(`oat`) 위에서는 `ink-faint`를 쓰지 않는다. 흰 바탕에서 4.77:1이지만 귀리 위에서는 4.2:1로 기준(4.5:1)에 못 미친다. 면 위의 흐린 글자는 `ink-muted`로 (`.card .muted`, 달력 요일 머리).

**누구 표시 4색** (`who-*`)은 dataviz 검증기(`validate_palette.js`)를 통과한 값이다. 명도대, 채도 하한, 색약 구분(최소 ΔE 17.9), 일반 시각 구분(최소 ΔE 25.1) 모두 통과. 단 **공동 → 자녀 → 남편 →아내** 순서로 붙여 놓을 때만 통과한다(아내와 자녀, 공동과 아내가 이웃하면 실패). 자녀 색(#CA9D42)은 흰 바탕 대비 2.43:1이라 항상 이름 글자와 함께 쓴다.

지출 금액은 먹색으로 쓴다. 빨간 계열을 지출 전체에 칠하지 않는다. 들어온 돈만 쪽빛과 `+`를 붙인다.

## Typography

글꼴은 **SUIT 2.0.5** 한 가족이다(OFL-1.1, 한글 11,172자 전부, 가변 woff2 625KB). Pretendard(라틴이 Inter 기반이고 AI 생성 앱의 기본값)와 Wanted Sans(가변 1.29MB)를 같은 화면에 렌더링해 비교한 뒤 골랐다. 굵기로 위계를 나누고, 금액에는 `font-variant-numeric: tabular-nums`를 건다.

- `display` 50/800: 화면당 한 번, 홈의 남은 돈.
- `title` 24/800: 화면 제목. `section` 17/700: 묶음 제목(날짜 등).
- `body` 16/500, `amount` 16/700: 목록 행.
- `meta` 13/500: 보조 정보. 한글 문장은 13px 아래로 내리지 않는다.
- `tag` 12/600: 플랫폼, 사람 태그(두세 글자).
- `calendar-amount` 10.5/600: 달력 칸 금액. 숫자만 쓴다. 고정지출 예정분(D-030)은 같은 글자에 1px 점선 테두리(`ink-muted`, 둥근 4px)를 둘러 실제 금액과 구별한다(흐린 글자로 구별하지 않는다: 귀리 면 위 대비 기준).

## Layout

- 모바일 390px 기준, 좌우 여백 20px, 묶음 면은 화면 끝에서 12px 안쪽.
- 간격은 4의 배수만 쓴다. 묶음 사이 24px, 묶음 안 행 사이는 선 하나.
- 홈: 남은 돈 → 쓴 돈 막대 → 달력(귀리 면) → 고른 날의 내역 → 오른쪽 아래 "기록하기" 버튼.
- 아래 탭 5개(달력, 내역, 장보기, 통계, 고정), 높이 80px, 켜진 탭만 먹색과 굵은 글자. 설정은 아래 탭에 두지 않고 화면 위쪽 줄 오른쪽 톱니 버튼으로 연다(설정 화면 왼쪽 위에 돌아가기). Apple HIG·Material 모두 아래 탭을 3~5개로 권해서 장보기를 넣으며 설정을 뺐다(D-010).

### 넓은 화면 (창 너비 960px 이상)

일반 컴퓨터와 가로로 둔 태블릿. 기준은 창 너비 하나이고(`styles.css`와 `Sheet.tsx`의 `WIDE_SCREEN`), 휴대폰 화면은 바꾸지 않는다.

- 화면 폭은 최대 1200px. 아래 탭은 왼쪽 216px 세로 메뉴가 되고, 맨 위에 "기록하기" 주 버튼을 둔다(오른쪽 아래 둥근 버튼은 숨긴다). 탭 다섯 아래에 "설정" 줄을 하나 더 두고, 위쪽 줄의 톱니·돌아가기는 숨긴다. 켜진 메뉴는 귀리 면.
- 고정지출 예정분(D-030·보충): 오늘 뒤에 나갈 고정지출·구독·할부는 이미 정해진 지출이라 쓴 돈·남은 돈·내역 탭 합계·통계(분류·주별·12개월·누구 몫)에 넣는다. 달력 칸은 점선 금액, 남은 돈 아래 "고정지출 예정 X원, N건 포함", 고른 날 머리 "X원 나갈 예정"("썼어요"에는 넣지 않음), 내역 줄은 '예정' 점선 태그와 흐린 금액(누르면 고정 탭, 고르기에서는 숨김). 앞 달(오늘 뒤의 달)은 "N월에 나갈 돈"·"나갈 돈"으로 쓰고, 통계의 지난달·작년 비교·살펴보기·제안을 숨긴다(고정지출만 있는 달이라 비교가 틀린다).
- 고정 탭 달 넘기기(D-030 보충): 위쪽 달 넘김은 달력·내역·통계와 같은 달을 쓴다. 묶음 맨 위는 그 달에 나가는 돈(들어간 내역 + 오늘 뒤 정해진 금액, 달력과 같은 기준)과 "내역에 들어간 것 / 앞으로 나갈 것", 관리비 지난번 금액은 "별도"로. 항목 오른쪽 아래는 "10/10 기록됨"·"11/10 예정"·"9/25 기록 없음"·"N월엔 없음". 기간을 정한 항목(D-030 보충 2)은 고른 달 기준 "6회 중 3회째, 3회 남음"(할부는 "6개월 중", 산 달이 1회차)·"마지막 회", 끝난 뒤는 "다 냈어요·끝났어요"를 꺼 둔 줄처럼 흐리게(오른쪽 아래 상태 없음). 시작 전 항목은 지난 달에서 빼고, 이번 달·앞 달에서는 "N월부터"로 흐리게 둔다. 지난 달에는 관리비 지난번 금액을 붙이지 않는다.
- 달력 탭: 창 너비 1180px 이상이면 왼쪽에 남은 돈·달력·다가오는 기념일, 오른쪽에 고른 날의 내역(두 단 사이 40px). 그보다 좁으면 달력 칸이 휴대폰보다 좁아져 금액이 맞붙으므로 한 단으로 둔다.
- 나머지 탭: 읽기 좋은 폭(760px)의 한 단. 위쪽 제목·달 이동도 같은 폭에 맞춘다. 최근 12개월 그래프는 높이 240px까지만 커진다.
- 시트는 가운데 창(기본 560px, 내역 입력은 880px 두 단: 왼쪽 금액·키패드, 오른쪽 분류부터 저장까지). 그림자 없이 뒤 막으로만 띄우고, 손잡이 줄과 끌어 닫기는 없다. 닫기 버튼·Esc·바깥 누르기로 닫는다.
- 키보드: 내역 입력 창에서 글자 칸 밖의 숫자·Backspace는 금액으로 들어가고(안내 문장은 마우스가 있는 화면에서만 보인다), ⌘+Enter(그 밖은 Ctrl+Enter)는 어디서든 저장. 단축키와 한글 조합 중에는 끼어들지 않는다. 그냥 Enter는 고른 칩·버튼을 누르는 키라 저장에 쓰지 않는다.

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
- **내역 행**: 첫 줄 상품명(`body`), 둘째 줄 플랫폼 태그 + 사람 태그(공동이 아닐 때만) + 쉼표로 이은 보조 정보(`meta`), 오른쪽 금액(`amount`). 행마다 아이콘 타일을 붙이지 않는다. 구독만 실제 서비스 로고를 붙인다. 예외는 고정 탭의 반복 항목 줄: 구독은 로고, 그 밖(고정지출·관리비·할부)은 이름·종류로 고른 분류 아이콘 타일(`RecurringIcon`, 세금·보험·주거·대출·통신·교육·공과금·할부·수입·차·건강·고정)을 붙인다(사용자 요청 2026-10-20).
- **칩**: 기본은 귀리 면, 선택되면 먹색 면에 흰 글자. 사람 칩에는 8px 색 점을 앞에 붙인다.
- **내역 고르기** (내역 탭, D-027): 합계 줄 오른쪽 끝의 "고르기" 글자 버튼으로 켜고 "고르기 취소"로 끈다. 켜지면 행 앞과 날짜 앞에 체크 상자(날짜는 그날 보이는 내역 전부, 일부만 고르면 반쯤 찬 표시)가 붙고, 행을 눌러도 수정 시트가 열리지 않는다. 기록하기 둥근 버튼은 숨기고 그 자리 위에 귀리 면 줄(모서리 20px, 아래 탭 위 12px에 붙어 있음, 둘레 12px는 바탕색으로 가림)을 둔다: "N건 골랐어요, 지출 N원"과 테두리 삭제 버튼. 휴대폰은 위아래 두 줄, 넓은 화면은 한 줄(버튼 오른쪽). 삭제는 한 번 누르면 "한 번 더 누르면 N건 지워요"로 바뀌고 다시 눌러야 지운다.
- **같은 영수증 묶음** (수정 시트, D-027): 나눠 저장한 내역이면 삭제하기 아래에 선을 긋고 "함께 나눠 저장한 내역 N건"(지난 내역은 추정 묶음이라 "같은 영수증"이라고 쓰지 않는다), 이름·금액 목록(지금 보는 내역은 굵게 + "지금 보는 내역" 태그), 합계, "N건 모두 삭제"(두 번 누르기).
- **업데이트 내역** (설정 '앱' 카드, D-028): 지금 버전 줄 오른쪽에 굵은 "v2.6.0", 그 아래 12px 흐린 빌드 문자열. 선 아래 "업데이트 내역": 최신 릴리스 하나를 펼쳐(버전 굵게, 종류 태그 '큰 업데이트'는 먹색 면·'기능 추가'·'버그 수정'은 흰 면, 날짜 흐리게, 제목 15px 굵게, 바뀐 점 점 목록 14px 흐리게) 두고 지난 것은 "지난 업데이트 N개" 접기 안에 선으로 나눠 둔다. 새 버전을 처음 열면 알림 "새 버전 vX.Y.Z: 제목" 한 번.
- **나누기 체크박스** (영수증 확인 화면): 상품이 두 개 이상인 주문 위에 "OO N원, 상품 N개를 하나씩 따로 저장". 기본은 꺼져 있고(한 내역), 글자는 켜고 꺼도 바뀌지 않는다.
- **관리비 묶음**: 금액, 지난달·작년 대비 문장 두 개, 사용량 표(이번 달, 지난달 %, 작년 %). 줄어든 값은 세이지 진한색, 늘어난 값은 흙빛.
- **주유 묶음** (통계, 관리비 다음): 큰 숫자는 최근 리터당 가격 하나(22px), 그 아래 날짜·주유소·유종(meta), "지난 주유보다 ▲ 23원 (+1.4%)"는 흙빛(오름)·쪽빛(내림) 글자와 기호를 함께(색만으로 알리지 않음, 같으면 "같아요"), 리터당 가격 선 그래프는 세이지 선 하나에 첫·마지막·최저·최고 값을 글자로 직접 쓰고 범례는 없다(넓은 화면은 높이 200px까지). 다른 유종은 선 없이 속 빈 점. 이번 달·지난달 두 줄, 평균 간격 한 문장, 최근 주유는 접힌 목록. 빈 상태는 한 문장과 "주유 영수증 넣기" 버튼.
- **주유 칸** (영수증 확인 화면): 유종·주유량(L)·리터당(원) 세 입력을 한 줄에(1.2:1:1), 아래 "단가 × 주유량 = N원"과 지난 주유(같은 유종) 대비 한 줄. 비어 있으면 "리터와 단가를 모두 적어야 주유 기록이 저장돼요"로 안내하고 내역만 저장한다.
- **이번 장보기 살펴보기** (영수증 확인 화면, 초안 카드들 아래·장보기 연결 위): 첫 줄에 개수·합계와 지난 장보기 대비(▲▼ 원), 그 아래 "지난번보다 비싸진 것 N"처럼 제목 + 개수 묶음을 차례로. 줄마다 상품명(굵게), 오른쪽에 이번 값과 ▲▼ 차이(비율), 아래 13px 흐린 글자로 지난 기록의 날짜·가게·값(다른 상품이면 그 상품명). 다섯 줄 넘으면 "N개 더 보기". 처음 사는 것은 접힘. 맨 아래 "최근 1년 가계부 기록과 견줬어요…" 안내. 판단 문장("안 사도 돼요")은 쓰지 않는다.
- **살펴보기·이렇게 해 보면** (통계 위쪽 두 카드): 살펴보기는 사실만, 세이지 점 목록으로 한 문장씩. 이렇게 해 보면은 흰 면에 한 제안씩, 아낄 수 있는 금액은 "한 달 약 N원" 태그로. 지난달 기록이 없으면 어디서도 지난달과 비교하지 않는다("지난달 기록 없음"). 제안은 이번 달·지난달 내역만 보고 규칙으로 찾고, 명령하지 않는다("줄여도 한 달 약 N원이에요").
- **분류·플랫폼 행**: 누르는 행이다. 분류는 여섯 달 추이(세이지 막대, 보고 있는 달만 진하게)와 "내역 보기", 플랫폼은 바로 내역 보기. 어디서 샀나에서 매장 결제는 가게 이름 옆에 "매장" 태그, 한 번만 간 가게도 묶지 않고 가게마다 한 줄(D-031), 이름이 없는 결제만 맨 뒤 "이름 없는 결제" 한 줄.
- **분류 제안**: 직접 입력에서 이름을 적으면 분류 칩이 먼저 골라지고 아래에 "이름을 보고 골랐어요. 다르면 바꿔 주세요."가 보인다. 사용자가 칩을 누르면 더 바꾸지 않는다.
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
| 가운데 창 (넓은 화면의 시트) | 몇 번 | 투명도 0→1과 8px 올라오기, 250ms `--ease-out`. 닫기도 같은 값. 뒤 막은 투명도만 |
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
