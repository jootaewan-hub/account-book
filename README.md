# 우리집 가계부

부부 두 사람이 함께 쓰는 가계부 웹앱(PWA)입니다. iPhone에서 Safari로 열고 "홈 화면에 추가"하면 앱처럼 씁니다.

## 지금 들어 있는 기능

- 이메일 + 비밀번호 로그인 (가입 시 확인 메일 1회, 비밀번호 재설정)
- 가계부 만들기 / 초대 코드로 배우자 참여 (최대 2명)
- 달력 홈: 이번 달 수입·지출·남은 돈, 지난달 같은 기간 대비, 날짜별 합계, 2026년 공휴일 표시
- 내역 추가·수정·삭제: 금액 키패드, 분류(자주 쓰는 순), 결제수단(누가 냈는지), 용도(공동/남편/아내)
- 스마트 입력: 카드 문자·알림톡을 붙여넣거나 영수증·주문내역 사진을 고르면 Claude가 날짜·가맹점·금액·품목을 읽어 오고, 확인·수정 후 저장
  (카드 끝 4자리로 결제수단 자동 선택, 같은 날 같은 금액은 중복으로 표시, 품목 합계가 안 맞으면 더 큰 모델로 한 번 더 읽기)
- 내역 탭: 공동·남편·아내 필터
- 설정: 초대 코드, 결제수단·분류 관리, 공동 지출 분담 비율
- 두 사람 화면 실시간 동기화 (Supabase Realtime)

다음 단계: 고정지출·구독·관리비, 통계·정산 화면, CSV/구글 시트 내보내기.

## 구조

| 경로 | 내용 |
|---|---|
| `supabase/migrations/` | DB 테이블, 권한(RLS), 가구 만들기·참여 함수, 내역+품목 저장 함수 |
| `supabase/functions/extract-entries/` | 문자·사진 → Claude 구조화 출력 → 내역 초안 (Edge Function) |
| `src/lib/` | 날짜·금액·정산 계산, Supabase 호출 |
| `src/components/` | 화면 |
| `tests/db.test.ts` | 마이그레이션을 PGlite에 적용해 권한 규칙 검증 |
| `tests/logic.test.ts` | 날짜·합계·정산 계산 검증 |
| `tests/smart.test.ts` | 모델 출력 정리, 결제수단·중복 판단, 사진 크기 계산 검증 |

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

1. [Claude Console > Workload identity](https://platform.claude.com/settings/workload-identity-federation) > **Connect workload** > **Custom OIDC**
   - Issuer URL: `https://kifdfpbwiebfgvdumqjf.supabase.co/auth/v1` (끝에 `/` 없이)
   - JWKS: discovery (기본값)
   - Audience: `authenticated`
   - Condition(CEL): `claims.app_metadata.household_id == "<우리 가구 id>"`
     (가구 id는 `select id from public.households`. 다른 사람이 앱에 가입해도 우리 가구 구성원이 아니면 거절됩니다)
   - Scope: `workspace:inference` (Claude 호출만 허용)
2. 만들어진 **organization ID**, **federation rule ID**(`fdrl_...`), **service account ID**(`svac_...`)를
   Supabase > Edge Functions > Secrets에 넣습니다.
   `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`
   (규칙이 여러 워크스페이스에 걸쳐 있으면 `ANTHROPIC_WORKSPACE_ID`도)

`household_id`는 가구에 참여할 때 DB 트리거가 `auth.users.raw_app_meta_data`에 넣고, 다음 토큰 갱신부터 JWT에 실립니다.
토큰 교환이 거절되면 앱이 로그인 토큰을 새로 받아 한 번 더 시도합니다. 거절 이유는 Console의 Workload identity > History에 남습니다.

WIF 대신 API 키를 쓰려면 위 세 값 대신 `ANTHROPIC_API_KEY`만 넣으면 됩니다.
모델은 `EXTRACT_MODEL`(기본 `claude-haiku-5-5`), 재시도 모델은 `EXTRACT_RETRY_MODEL`(기본 `claude-sonnet-5-5`)로 바꿀 수 있습니다.

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
- 승인 취소 문자는 자동으로 원래 내역을 지우지 않고 알려 주기만 합니다.
- 공휴일은 2026년만 들어 있습니다. 2027년 이후는 `src/lib/holidays.ts`에 추가해야 합니다.
- 오프라인에서는 화면만 열리고 내역을 불러오거나 저장할 수 없습니다.
