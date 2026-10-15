# 우리집 가계부

부부 두 사람이 함께 쓰는 가계부 웹앱(PWA)입니다. iPhone에서 Safari로 열고 "홈 화면에 추가"하면 앱처럼 씁니다.

## 지금 들어 있는 기능 (1단계)

- 이메일 + 비밀번호 로그인 (가입 시 확인 메일 1회, 비밀번호 재설정)
- 가계부 만들기 / 초대 코드로 배우자 참여 (최대 2명)
- 달력 홈: 이번 달 수입·지출·남은 돈, 지난달 같은 기간 대비, 날짜별 합계, 2026년 공휴일 표시
- 내역 추가·수정·삭제: 금액 키패드, 분류(자주 쓰는 순), 결제수단(누가 냈는지), 용도(공동/개인)
- 내역 탭: 공동·사람별 필터
- 설정: 초대 코드, 결제수단·분류 관리, 공동 지출 분담 비율
- 두 사람 화면 실시간 동기화 (Supabase Realtime)

다음 단계: 스마트 입력(문자 붙여넣기·영수증 사진 → Claude API), 고정지출·구독·관리비, 통계·정산 화면, CSV/구글 시트 내보내기.

## 구조

| 경로 | 내용 |
|---|---|
| `supabase/migrations/` | DB 테이블, 권한(RLS), 가구 만들기·참여 함수 |
| `src/lib/` | 날짜·금액·정산 계산, Supabase 호출 |
| `src/components/` | 화면 |
| `tests/db.test.ts` | 마이그레이션을 PGlite에 적용해 권한 규칙 검증 |
| `tests/logic.test.ts` | 날짜·합계·정산 계산 검증 |

## 처음 설정

### 1. Supabase 프로젝트

현재 연결된 프로젝트: `account-book` (ref `kifdfpbwiebfgvdumqjf`, 서울 ap-northeast-2, 무료 플랜)

1. `supabase/migrations/20261015000000_init.sql`을 적용합니다. (이 프로젝트에는 적용 완료)
2. Authentication > URL Configuration의 **Site URL**을 배포한 앱 주소로 바꿉니다.
   가입 확인 메일과 비밀번호 재설정 메일의 링크가 이 주소로 돌아옵니다.
3. 두 사람이 가입을 마치면 Authentication > Sign In / Providers에서 **Allow new users to sign up**을 꺼서 다른 사람이 가입하지 못하게 합니다.

로그인을 이메일 코드가 아닌 비밀번호로 한 이유: 2026-06-03 이후 만든 무료 프로젝트는 기본 메일 서버를 쓰는 동안
메일 양식을 바꿀 수 없고, 기본 로그인 메일에는 숫자 코드가 없습니다
([Supabase 공지](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)).

보안 점검(Advisors) 결과 `create_household`, `join_household`가 "로그인 사용자가 실행 가능한 SECURITY DEFINER 함수"로
경고됩니다. 가구 생성·참여를 위해 의도한 것이며, 두 함수는 안에서 로그인 여부·기존 가구 여부·인원(2명)을 직접 확인합니다.

### 2. 환경 변수

`.env.example`을 `.env`로 복사하고 값을 채웁니다.

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

### 3. 실행

```bash
npm install
npm run dev      # 개발 서버
npm test         # 테스트
npm run build    # 배포용 빌드 (dist/)
```

### 4. 배포와 설치

- `dist/`를 정적 호스팅(Vercel, Cloudflare Pages 등)에 올리고, 같은 환경 변수를 호스팅 설정에 넣습니다.
- iPhone Safari로 주소를 열고 공유 버튼 > "홈 화면에 추가"를 누릅니다.
- 각자 "처음 가입" → 메일의 확인 링크 → 앱에서 로그인.
- 한 사람이 "새 가계부 만들기", 다른 사람은 설정 화면의 초대 코드로 "초대 코드로 참여"를 합니다.

## 알려진 제한

- 공휴일은 2026년만 들어 있습니다. 2027년 이후는 `src/lib/holidays.ts`에 추가해야 합니다.
- 오프라인에서는 화면만 열리고 내역을 불러오거나 저장할 수 없습니다.
