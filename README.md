# 우리집 가계부

부부 두 사람이 함께 쓰는 가계부 웹앱(PWA)입니다. iPhone에서 Safari로 열고 "홈 화면에 추가"하면 앱처럼 씁니다.

## 지금 들어 있는 기능

- 이메일 + 비밀번호 로그인 (가입 시 확인 메일 1회, 비밀번호 재설정)
- 가계부 만들기 / 초대 코드로 배우자 참여 (최대 2명)
- 달력 홈: 이번 달 수입·지출·남은 돈, 지난달 같은 기간 대비, 날짜별 합계, 2026년 공휴일 표시
- 내역 추가·수정·삭제: 금액 키패드, 분류(자주 쓰는 순, '자녀' 분류 포함), 누구를 위한 지출인지(공동/남편/아내/자녀). 카드·결제수단은 고르지 않음
- 스마트 입력 (문자 / 영수증 / 쇼핑 주문): Claude가 날짜·가맹점·금액·품목을 읽어 오고, 확인·수정 후 저장
  (같은 날 같은 금액은 중복으로 표시, 영수증·문자는 품목 합계가 안 맞으면 더 큰 모델로 한 번 더 읽기). 사진은 최대 20장까지 모아서(카메라로 한 장씩, 앨범에서 여러 번 골라도 됨) 분석. Edge Function 시간 제한(무료 요금제 150초) 때문에 5장씩 나눠 동시에(20장이면 4묶음) 보내고 결과를 합친다. 여러 쇼핑몰 캡처를 섞어도 주문마다 플랫폼을 따로 읽는다
- 쇼핑 주문 캡처: 캡처 화면이 어느 플랫폼(쿠팡·네이버·오늘의집·컬리 등, 목록에 없으면 화면에 보이는 이름)인지 읽어 '플랫폼' 칸에 따로 저장하고,
  내역 이름은 상품명으로(여러 개면 '상품, 상품', 길면 '첫 상품 외 N건'). 품목마다 상품명·수량·개당 가격·금액·상품 사진과
  단위당 가격(g·ml는 100g·100ml당, 매·개·구 같은 셈 단위는 1개당; 상품명의 용량에서 계산)을 함께 저장.
  배달앱은 내역 이름을 가게 이름으로, 매장 영수증·카드 문자는 가맹점 이름으로 둔다.
- 상품별 내역: 상품이 두 개 이상인 주문·영수증은 상품마다 내역 하나로 나눠 저장(확인 화면에서 주문마다 '한 내역으로 저장'으로 바꿀 수 있음).
  상품마다 분류를 따로 고르고, 쿠폰·할인은 상품 금액 비율로 나눠 빼며(메모에 기록), 배송비는 따로 한 건. 나눈 내역의 합계는 결제 금액과 같다.
  한 번의 분석에서 같은 상품(같은 날·이름·상품 금액)이 또 나오면 뒤의 것은 체크를 풀어 둔다.
  상품 사진은 모델이 알려 준 위치를 기기에서 잘라(240px JPEG) 비공개 Storage 버킷 `item-images`에 가구별 폴더로 올림. 잘못 잘린 사진은 저장 전에 눌러서 뺌
- 내역 탭: 공동·남편·아내·자녀 필터, 품목이 있는 내역은 첫 상품 사진과 품목 수 표시
- 고정 탭: 고정지출(월세·보험·월급)·구독·관리비. 날짜가 지나면 자동으로 내역에 들어가고(매달/매년, 31일은 말일),
  금액이 매달 다른 관리비는 날짜가 되면 "입력할 차례"로 알려 줌. 최근 6개월 내역에서 구독처럼 보이는 지출을 찾아 등록 제안
- 통계 탭: 이번 달 수입·지출의 전월·전년 대비(이번 달은 같은 기간끼리), 최근 12개월 막대그래프, 분류별 지출과 전월 대비,
  플랫폼별 지출(저장된 플랫폼 칸 기준, 예전 내역은 이름으로 짐작, 없으면 '그 외'), 공동·남편·아내·자녀별 지출
- 내보내기(설정): CSV 파일, 또는 구글 시트에 `=IMPORTDATA(...)` 수식 한 줄로 전체 내역 자동 채우기 (플랫폼 칸, 품목의 개당·단위당 가격 포함)
- 설정: 초대 코드, 분류 관리, 내보내기
- 관리비 고지서: 고지서 사진(최대 5장)에서 몇 월분·부과 금액·항목별 금액·세대 사용량(전기·수도·온수·난방·가스)을 읽어 저장하고,
  통계 탭에서 전월·전년 같은 달과 비교(지난 고지서가 없으면 고지서에 적힌 전월·전년 값 사용)와 최근 12개월 관리비 추이를 보여 줌.
  저장할 때 가계부 지출로도 넣고, 고정 탭에 '관리비'(금액 매달 다름) 항목이 있으면 그 달 분으로 연결해 입력 알림을 끔
- 구독 로고: 넷플릭스·유튜브·스포티파이·네이버·카카오·Claude 등은 [Simple Icons](https://simpleicons.org)(CC0) 로고 모양을,
  티빙·웨이브·왓챠·쿠팡·디즈니+·멜론·ChatGPT 등 Simple Icons에 없는 서비스는 브랜드 색(근사값) 바탕에 이름을 그림. 로고 상표는 각 회사 것
- 두 사람 화면 실시간 동기화 (Supabase Realtime)
- 새 버전 자동 반영: 앱으로 돌아올 때마다 새 버전을 확인하고, 입력 중이 아니면 바로 새로 고침(입력 중이면 위에 알림). 설정 맨 아래에 앱 버전(커밋·빌드 시각) 표시

## 구조

| 경로 | 내용 |
|---|---|
| `supabase/migrations/` | DB 테이블, 권한(RLS), 가구 만들기·참여 함수, 내역+품목 저장 함수 |
| `supabase/functions/extract-entries/` | 문자·사진 → Claude 구조화 출력 → 내역 초안 (Edge Function) |
| `supabase/functions/export-csv/` | 구글 시트 IMPORTDATA용 CSV (가구별 비밀 주소, 로그인 없이 호출) |
| `src/lib/` | 날짜·금액·통계 계산, 사진 자르기, Supabase 호출 |
| `src/components/` | 화면 |
| `tests/db.test.ts` | 마이그레이션을 PGlite에 적용해 권한 규칙 검증 |
| `tests/logic.test.ts` | 날짜·합계 계산 검증 |
| `tests/smart.test.ts` | 모델 출력 정리, 상품 사진 영역 검사·자르기 영역, 중복 판단, 사진 크기 계산 검증 |
| `tests/recurring-stats.test.ts` | 반복 날짜(말일·매년), 관리비 알림, 구독 후보, 12개월 추이·증감률·분류별·플랫폼별 계산 검증 |

## 처음 설정

### 1. Supabase 프로젝트

현재 연결된 프로젝트: `account-book` (ref `kifdfpbwiebfgvdumqjf`, 서울 ap-northeast-2, 무료 플랜)

1. `supabase/migrations/`의 SQL을 파일 이름 순서대로 적용합니다.
2. Authentication > URL Configuration의 **Site URL**을 배포한 앱 주소로 바꿉니다.
   가입 확인 메일과 비밀번호 재설정 메일의 링크가 이 주소로 돌아옵니다.
3. 두 사람이 가입을 마치면 Authentication > Sign In / Providers에서 **Allow new users to sign up**을 꺼서 다른 사람이 가입하지 못하게 합니다.

로그인을 이메일 코드가 아닌 비밀번호로 한 이유: 2026-06-03 이후 만든 무료 프로젝트는 기본 메일 서버를 쓰는 동안
메일 양식을 바꿀 수 없고, 기본 로그인 메일에는 숫자 코드가 없습니다
([Supabase 공지](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)).

보안 점검(Advisors) 결과 `create_household`, `join_household`가 "로그인 사용자가 실행 가능한 SECURITY DEFINER 함수"로
경고됩니다. 가구 생성·참여를 위해 의도한 것이며, 두 함수는 안에서 로그인 여부·기존 가구 여부·인원(2명)을 직접 확인합니다.

### 2. Claude API 연결 (API 키 없이: Workload Identity Federation)

Edge Function `extract-entries`는 로그인한 사람의 Supabase 로그인 토큰(JWT)을 Anthropic에 보여 주고
몇 분짜리 액세스 토큰으로 바꿔서 Claude를 부릅니다. 그래서 어디에도 `sk-ant-...` API 키를 저장하지 않습니다.
Supabase Auth가 `https://<ref>.supabase.co/auth/v1/.well-known/openid-configuration`과 ES256 공개키(JWKS)를 공개하므로
Anthropic이 이 토큰의 서명을 직접 확인할 수 있습니다.

1. **Supabase 훅**: Authentication > Auth Hooks > Customize Access Token (JWT) Claims를 Postgres `public.custom_access_token_hook`으로 켭니다.
   Anthropic은 토큰의 `aud`에 `https://api.anthropic.com`이 있어야 받는데, 이 함수가 기존 `authenticated`에 그 주소를 덧붙입니다.
   켠 뒤에는 로그아웃 → 다시 로그인해야 새 토큰을 받습니다.
2. [Claude Console > Workload identity](https://platform.claude.com/settings/workload-identity-federation) > **Connect workload** > **Custom OIDC**
   - 1단계 발급자: 이름 `supabase-account-book`, 발급자 URL `https://kifdfpbwiebfgvdumqjf.supabase.co/auth/v1`(끝에 `/` 없이),
     JWKS 소스 OIDC 디스커버리, 디스커버리 기본 URL·CA 인증서 비움, 일회용 토큰(JTI) 켬, 최대 유효 기간 1시간,
     "디스커버리 문서 및 JWKS는 공개 인터넷에서 접근 가능" 체크
   - 2단계 규칙: 주체(sub) 클레임 **`*`** (아무 값이나 넣으면 sub가 그 값과 같아야 해서 전부 거절됨),
     추가 클레임 조건 `claims.app_metadata.household_id == "<우리 가구 id>"`, 워크스페이스는 Default 하나
   - 3단계 서비스 계정: 새로 만들기 (`account-book-app`)
   - 4단계 화면의 `federation_rule_id`, `organization_id`, `service_account_id`, `workspace_id`를
     `supabase/functions/extract-entries/wif-config.ts`에 적고 함수를 다시 배포합니다.
     비밀값이 아닌 식별자라서 코드에 둡니다(Anthropic의 GitHub Actions 가이드도 워크플로 파일에 그대로 적습니다).
     Supabase > Edge Functions > Secrets에 `ANTHROPIC_ORGANIZATION_ID` 등 같은 이름을 넣으면 그 값이 우선합니다.

`household_id`는 가구에 참여할 때 DB 트리거가 `auth.users.raw_app_meta_data`에 넣고, 다음 토큰 갱신부터 JWT에 실립니다.
토큰 교환이 거절되면 앱이 로그인 토큰을 새로 받아 한 번 더 시도합니다. 거절 이유는 응답에 없고 Console의 Workload identity 인증 기록에만 남습니다.

WIF 대신 API 키를 쓰려면 위 세 값 대신 `ANTHROPIC_API_KEY`만 넣으면 됩니다.
모델은 코드에 고정돼 있습니다: 문자·영수증은 `claude-haiku-5-5`, 품목 합계가 안 맞을 때 다시 읽기는 `claude-sonnet-5-5`,
쇼핑 주문은 `claude-sonnet-5-5`(상품 사진 위치를 픽셀 좌표로 받기 위해), 관리비 고지서도 `claude-sonnet-5-5`(작은 표를 정확히 읽기 위해). 확인 화면 아래에 실제로 응답한 모델 이름이 나옵니다.

### 3. 환경 변수

`.env.example`을 `.env`로 복사하고 값을 채웁니다.

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

### 4. 실행

```bash
npm install
npm run dev      # 개발 서버
npm test         # 테스트
npm run build    # 배포용 빌드 (dist/)
```

### 5. 배포와 설치

- `main`에 올리면 GitHub Actions가 테스트 후 GitHub Pages(https://jootaewan-hub.github.io/account-book/)에 배포합니다.
- iPhone Safari로 주소를 열고 공유 버튼 > "홈 화면에 추가"를 누릅니다.
- 각자 "처음 가입" → 메일의 확인 링크 → 앱에서 로그인.
- 한 사람이 "새 가계부 만들기", 다른 사람은 설정 화면의 초대 코드로 "초대 코드로 참여"를 합니다.

## 알려진 제한

- 스마트 입력 결과는 저장 전에 꼭 확인하세요. 모델이 숫자를 잘못 읽을 수 있습니다.
- 상품 사진 위치는 모델이 정한 좌표라 어긋날 수 있습니다. 아주 긴 스크롤 캡처는 보내기 전에 줄여서(긴 변 2400px 이하) 작은 썸네일이 흐려질 수 있으니 화면 단위로 나눠 찍는 편이 낫습니다.
- 플랫폼은 모델이 화면에서 읽거나 가맹점 이름으로 짐작합니다. 카드 문자에 "쿠팡"이 아닌 결제대행사 이름이 찍히면 비어 있으니 직접 고쳐 주세요.
- 단위당 가격은 상품명에 적힌 용량으로 계산합니다. 용량이 없거나 모델이 잘못 읽으면 비거나 틀릴 수 있습니다. 쿠폰·배송비는 상품별로 나누지 않습니다.
- 승인 취소 문자는 자동으로 원래 내역을 지우지 않고 알려 주기만 합니다.
- 구글 시트의 IMPORTDATA는 구글이 정한 주기로 다시 읽으므로 새 내역이 바로 보이지 않을 수 있습니다. 수식 주소를 아는 사람은 누구나 내역을 볼 수 있으니 시트를 공유하지 마세요.
- 반복 내역 자동 입력은 앱을 열 때 실행됩니다. 앱을 한동안 안 열어도 다음에 열면 밀린 달(최대 12개월)을 채웁니다.
- 공휴일은 2026년만 들어 있습니다. 2027년 이후는 `src/lib/holidays.ts`에 추가해야 합니다.
- 오프라인에서는 화면만 열리고 내역을 불러오거나 저장할 수 없습니다.
