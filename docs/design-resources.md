# 디자인 자료 쓰는 법 (이 앱 전용)

`design-resource-stack` 스킬(웹·앱 디자인 사이트 27곳 공정별 적용표)을 이 저장소에서 쓸 때는 스킬의 "2. 공정별 적용표"와 "4. 라이선스 규칙" 기본값 대신 이 문서를 따른다(D-047, 아이콘·모양 바꾸기는 D-048). 스킬은 빈 프로젝트를 전제로 만들어져 있고, 이 앱은 글꼴·색·아이콘·모션을 `DESIGN.md`에 근거와 함께 이미 정해 두었기 때문이다.

조건: 유형 B(PWA 웹앱), Vite + React 19, 일반 CSS(Tailwind·shadcn·motion 라이브러리 없음), 두 사람만 쓰지만 GitHub Pages로 공개 배포(라이선스는 상업용 기준으로 본다), 한글 있음.

## 1. 공정별로 쓰는 것

| 공정 | 쓰는 것 | 어떻게 | 막는 규칙 |
|---|---|---|---|
| 1. 레퍼런스 | Design Spells | 동작 사례를 볼 때만. 코드는 가져오지 않는다 | `DESIGN.md` Motion "어디를 움직이나"의 빈도 기준 |
| 2. 컬러 | `DESIGN.md` 토큰 그대로(흰 바탕·귀리 면. 회색 바탕 시안은 사용자가 되돌림, D-048 보충) | Realtime Colors·Coolors는 다른 조합을 미리 볼 때만. 토큰을 바꾸려면 대비(흰 바탕·귀리 면 위 4.5:1)와 `who-*` 색 순서 검증을 다시 한다 | `DESIGN.md` Colors |
| 3. 폰트 | SUIT 2.0.5 하나 | 바꾸지 않는다. Fontshare 등 목록의 글꼴은 한글 지원을 확인하지 못했다 | `DESIGN.md` Typography |
| 4. UI 컴포넌트 | Magic UI(MIT) 코드를 옮겨 쓴다 | 소스를 읽고 Web Animations API·일반 CSS로 다시 쓴다(motion·Tailwind를 들이지 않음). 옮긴 것은 `CREDITS.md` "컴포넌트·모션 코드"에 적는다. 21st.dev는 shadcn·Tailwind 설치와 하루 2회 제한이 있어 쓰지 않는다 | "AI처럼 보이지 않게"(CLAUDE.md): 반짝이·테두리 빛(Shimmer Button, Border Beam, Sparkles, Aurora Text, Meteors)·타자 치듯 나오는 글자는 쓰지 않는다 |
| 5. 아이콘 | Iconify의 Phosphor(MIT) 한 가족 | `node scripts/iconify-icon.mjs ph:이름 --write` (아래 5절) | `DESIGN.md` 아이콘 절: 보통 굵기, 켜진 탭은 -fill, 18px 이하 표시는 -fill·-bold. 이모지 금지 |
| 6. 일러스트 | 쓰지 않는다 | 빈 상태는 한 문장과 버튼 | `docs/grocery/DESIGN.md` "빈 상태: 그림 없음" |
| 7. 사진 | 쓰지 않는다 | 상품 사진은 출처 응답의 이미지만 | 화면의 숫자·사진은 출처가 있는 것만 |
| 8. 3D | 쓰지 않는다 | | |
| 9. 모션 | `src/components/Motion.tsx`와 CSS 토큰 | 새 움직임은 Magic UI·React Bits·transitions.dev를 참고해 이 파일에 쓰고, `DESIGN.md` Motion 표에 한 줄 더한다 | 돈 숫자 굴리기(Number Ticker·Count Up), 화면 들어올 때마다 떠오르기, 자주 하는 동작의 큰 움직임 금지 |
| 10. 목업 | 쓰지 않는다 | 화면 확인은 `npm run screens` | |

## 2. 라이선스

- 화면에 출처를 보여야 하는 자료(Storyset, Lordicon·Icons8 무료판)는 쓰지 않는다.
- MIT·ISC·OFL은 저작권 표시와 원문을 함께 배포해야 한다. 원문은 `public/`(글꼴은 `public/fonts/`, 그 밖은 `public/licenses/`)에 두고, 무엇을 어디서 가져왔는지는 `CREDITS.md`에 적는다.
- React Bits는 "MIT + Commons Clause"다(2026-11-03 저장소 LICENSE.md 확인). 앱·웹사이트 안에 넣어 쓰는 것은 허용, 컴포넌트를 따로 팔거나 묶어 재배포하는 것은 금지. 옮겨 쓰면 원문을 `public/licenses/`에 둔다.
- 유료 플랜은 쓰지 않는다. 쓰게 되면 가격·라이선스 페이지를 그날 다시 확인한다.

## 3. 지금 들어간 것 (v2.24.0)

- 모양: 층마다 다른 둥글기(태그 4·칩 8·버튼 10·기록하기 14·묶음 16·시트 20), 알약 버튼·칩 없음, 장보기 나눔 단추의 고른 칸은 먹색 칠 대신 밝은 면(D-048). 색은 그대로(흰 바탕·귀리 면).
- 아이콘: 손으로 그린 아이콘과 Lucide를 모두 Phosphor로 바꿨다(아래 탭·위쪽 줄·달력·기념일·날씨·고정 탭 분류 타일). 켜진 탭은 채운 모양.
- 저장·삭제 알림의 체크(Phosphor `check-bold`, 왼쪽부터 드러남).
- 알아보기 검색 결과 도착: Magic UI `BlurFade`를 옮긴 `useArrival`.
- 보조 정보를 잇던 ` · `를 쉼표로.
- 디자인 스킬(design-critique, interaction-design)로 비평한 뒤: 장보기 나눔 단추 미끄러지는 표시, 메모 고정 단추(핀)와 순서 바뀜 움직임(`useFlip`), 장보기 체크 피드백, '+' 글자를 아이콘으로(D-048 보충 2).

## 4. 하지 않기로 한 것과 까닭

| 후보 | 까닭 |
|---|---|
| Magic UI Number Ticker, React Bits Count Up | 금액 숫자 애니메이션 금지(`DESIGN.md` Do's and Don'ts) |
| Magic UI Blur Fade를 화면마다 | "화면 들어올 때마다 위로 떠오르기" 금지. 기다리던 결과가 도착한 때만 쓴다 |
| Shimmer Button, Border Beam, Sparkles, Click Spark | 반짝이 효과는 "AI처럼 보이지 않게" 규칙 위반 |
| Lordicon 움직이는 아이콘 | 무료판은 출처 표기 필수, 아이콘이 계속 움직임 |
| Lucide·Feather 꼴 선 아이콘 | AI 생성 앱(shadcn 등)의 기본 아이콘이라 D-048에서 Phosphor로 바꿨다 |
| unDraw·Storyset 일러스트 | 빈 상태 그림 없음 규칙 |
| 21st.dev 블록 | shadcn·Tailwind 설치가 필요하고 무료는 하루 2회 |

이 표의 항목을 쓰려면 먼저 `DESIGN.md`·`CLAUDE.md`의 해당 규칙을 사용자가 바꿔야 한다.

## 5. 아이콘 가져오기

```
node scripts/iconify-icon.mjs ph:piggy-bank                 # 컴포넌트를 화면에만 찍는다
node scripts/iconify-icon.mjs ph:receipt --name BillIcon --write
```

- 세트는 `ph`(Phosphor)만(`scripts/iconify-lib.mjs`의 `ALLOWED_SETS`). 한 가족으로 모양을 맞추려고 라이선스만 보지 않고 세트를 고정했다.
- 굵기는 보통(이름 그대로), 채움(`-fill`), 18px 이하 작은 표시용 굵게(`-bold`)만. 가는(`-thin`·`-light`)·두 톤(`-duotone`)은 거절한다.
- 스크립트는 Iconify 세트 정보의 라이선스가 MIT인지, 256×256 격자인지, 한 색 채움(`fill="currentColor"`)인지 본다. 반투명 층·움직임 요소·모르는 속성이 있으면 거절하고, 채움 속성을 빼서 `Icons.tsx`의 공통 속성 `ph`(viewBox 256, fill currentColor)로 그린다.
- 아래 탭처럼 켜짐·꺼짐이 있는 아이콘은 보통·채움 두 본문을 받아 `({ on }) => on ? 채움 : 보통` 컴포넌트로 묶는다(`Icons.tsx`의 `CalendarIcon` 등).
- `--write`는 `Icons.tsx` 끝에 붙이고 `CREDITS.md`에 한 줄, 라이선스 원문이 없으면 `public/licenses/ph-LICENSE.txt`에 받아 둔다.
- 앱은 실행 중에 Iconify를 부르지 않는다. 도형이 코드에 들어간다.
- 붙인 뒤 그 아이콘이 나오는 화면을 `npm run screens`로 390·1280px, 라이트·다크 캡처해 다른 아이콘 옆에서 크기·무게를 본다.
