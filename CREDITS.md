# 밖에서 가져온 디자인 자료

앱 화면에 들어간 남의 글꼴·아이콘·컴포넌트 코드와 그 라이선스다. 무엇을 어디서 가져와도 되는지는 `docs/design-resources.md`에 있다. 화면에 출처를 보여야 하는 자료(Storyset·Lordicon·Icons8 무료판 등)는 쓰지 않으므로 화면 표기는 없다. MIT·ISC·OFL은 저작권 표시와 라이선스 원문을 함께 배포해야 해서 원문을 `public/` 아래에 둔다(배포본에 같이 실림).

## 글꼴

| 자료 | 저작권자 | 라이선스 | 원문 |
|---|---|---|---|
| SUIT 2.0.5 (가변 woff2) | SUNN (http://sun.fo/suit) | OFL-1.1 | `public/fonts/SUIT-OFL.txt` |

## 브랜드 로고

| 자료 | 저작권자 | 라이선스 | 비고 |
|---|---|---|---|
| simple-icons 16.33.0 (구독 서비스 로고, `src/lib/services.ts`) | Simple Icons 기여자 | CC0-1.0 | 로고 상표는 각 회사의 것이다. 구독 항목을 알아보게 하는 데만 쓴다 |

## 아이콘 (Iconify)

`node scripts/iconify-icon.mjs 세트:이름 --write`가 줄을 더한다. 도형은 `src/components/Icons.tsx`에 들어가고 선 두께는 앱 규칙(1.75px)으로 바꿨다.

| 컴포넌트 | 원본 | 저작권자 | 라이선스 | 주소 | 가져온 날 |
|---|---|---|---|---|---|
| `CheckIcon` | Lucide `check` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |
| `SunIcon` | Lucide `sun` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |
| `CloudSunIcon` | Lucide `cloud-sun` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |
| `CloudIcon` | Lucide `cloud` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |
| `CloudRainIcon` | Lucide `cloud-rain` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |
| `CloudDrizzleIcon` | Lucide `cloud-drizzle` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |
| `CloudSnowIcon` | Lucide `cloud-snow` | Lucide Icons and Contributors | ISC, `public/licenses/lucide-LICENSE.txt` | https://github.com/lucide-icons/lucide | 2026-11-03 |

## 컴포넌트·모션 코드

| 앱 코드 | 원본 | 저작권자 | 라이선스 | 바꾼 점 |
|---|---|---|---|---|
| `useArrival` (`src/components/Motion.tsx`) | Magic UI `BlurFade` (https://magicui.design/docs/components/blur-fade) | Magic UI | MIT, `public/licenses/magicui-LICENSE.txt` | motion 라이브러리 대신 Web Animations API, 위로 떠오르기 없이 흐림·투명도만, 기다리던 결과가 도착한 때 한 번만 |

디자인 규칙의 참고 자료(코드를 가져오지 않은 것)는 `DESIGN.md`의 "근거"에 적었다.
