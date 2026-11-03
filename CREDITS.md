# 밖에서 가져온 디자인 자료

앱 화면에 들어간 남의 글꼴·아이콘·컴포넌트 코드와 그 라이선스다. 무엇을 어디서 가져와도 되는지는 `docs/design-resources.md`에 있다. 화면에 출처를 보여야 하는 자료(Storyset·Lordicon·Icons8 무료판 등)는 쓰지 않으므로 화면 표기는 없다. MIT·OFL은 저작권 표시와 라이선스 원문을 함께 배포해야 해서 원문을 `public/` 아래에 둔다(배포본에 같이 실림).

## 글꼴

| 자료 | 저작권자 | 라이선스 | 원문 |
|---|---|---|---|
| SUIT 2.0.5 (가변 woff2) | SUNN (http://sun.fo/suit) | OFL-1.1 | `public/fonts/SUIT-OFL.txt` |

## 브랜드 로고

| 자료 | 저작권자 | 라이선스 | 비고 |
|---|---|---|---|
| simple-icons 16.33.0 (구독 서비스 로고, `src/lib/services.ts`) | Simple Icons 기여자 | CC0-1.0 | 로고 상표는 각 회사의 것이다. 구독 항목을 알아보게 하는 데만 쓴다 |

## 아이콘 (Iconify)

앱 아이콘은 모두 Phosphor 한 가족이다(D-048, 손으로 그린 아이콘과 Lucide는 뺐다). `node scripts/iconify-icon.mjs ph:이름 --write`가 `src/components/Icons.tsx`에 붙이고 이 표에 줄을 더한다.

| 컴포넌트 | 원본 | 저작권자 | 라이선스 | 주소 | 가져온 날 |
|---|---|---|---|---|---|
| `ChevronLeft` | Phosphor `caret-left` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `ChevronRight` | Phosphor `caret-right` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `Close` | Phosphor `x` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CloseBold` | Phosphor `x-bold` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `Plus` | Phosphor `plus` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CalendarIcon` | Phosphor `calendar-blank, calendar-blank-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `ListIcon` | Phosphor `list-bullets, list-bullets-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CartIcon` | Phosphor `shopping-cart-simple, shopping-cart-simple-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `ChartIcon` | Phosphor `chart-bar, chart-bar-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `RepeatIcon` | Phosphor `repeat, repeat-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `SearchIcon` | Phosphor `magnifying-glass, magnifying-glass-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `NoteIcon` | Phosphor `note, note-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `GearIcon` | Phosphor `gear-six, gear-six-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `MapPinIcon` | Phosphor `map-pin` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CameraIcon` | Phosphor `camera` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CheckIcon` | Phosphor `check-bold` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `AnnivIcon` | Phosphor `cake-fill, heart-fill, flower-lotus-fill, star-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `SunIcon` | Phosphor `sun` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CloudSunIcon` | Phosphor `cloud-sun` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CloudIcon` | Phosphor `cloud` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CloudRainIcon` | Phosphor `cloud-rain` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CloudSnowIcon` | Phosphor `cloud-snow` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `ReceiptIcon` | Phosphor `receipt` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `ShieldCheckIcon` | Phosphor `shield-check` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `HouseIcon` | Phosphor `house` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `BankIcon` | Phosphor `bank` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `DeviceMobileIcon` | Phosphor `device-mobile` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `BookOpenIcon` | Phosphor `book-open` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `LightningIcon` | Phosphor `lightning` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CreditCardIcon` | Phosphor `credit-card` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CoinsIcon` | Phosphor `coins` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `CarIcon` | Phosphor `car` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `HeartbeatIcon` | Phosphor `heartbeat` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |
| `PushPinIcon` | Phosphor `push-pin, push-pin-fill` | Phosphor Icons | MIT, `public/licenses/ph-LICENSE.txt` | https://github.com/phosphor-icons/core | 2026-11-03 |

## 컴포넌트·모션 코드

| 앱 코드 | 원본 | 저작권자 | 라이선스 | 바꾼 점 |
|---|---|---|---|---|
| `useArrival` (`src/components/Motion.tsx`) | Magic UI `BlurFade` (https://magicui.design/docs/components/blur-fade) | Magic UI | MIT, `public/licenses/magicui-LICENSE.txt` | motion 라이브러리 대신 Web Animations API, 위로 떠오르기 없이 흐림·투명도만, 기다리던 결과가 도착한 때 한 번만 |

디자인 규칙의 참고 자료(코드를 가져오지 않은 것)는 `DESIGN.md`의 "근거"에 적었다.
