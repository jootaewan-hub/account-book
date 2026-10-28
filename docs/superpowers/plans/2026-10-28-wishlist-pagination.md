# 함께 살 물건 보관함·전체 조회 구현 계획

> 이 세션에서 직접 구현한다. 설계: `docs/superpowers/specs/2026-10-28-wishlist-pagination-design.md`.

## 공통 제약

- 사용자가 보관함 위치를 ‘장보기 안’으로 선택했다. 아래 탭은 늘리지 않는다.
- 공유 DB 변경은 구현·검증 뒤 구체적인 SQL 확인을 받은 다음에만 한다. main 병합·푸시는 하지 않는다.
- 장보기 마이그레이션은 grocery만 변경한다. 내보내기 함수 수정은 별도 public 마이그레이션이다.
- 가격은 검색 결과의 값·출처·시각·수량/배송비 설명을 그대로 보관한다. 목표 가격은 사용자가 정한 값이다.
- 임시저장과 품목 편집은 제외한다.

## 검토할 실패 조건

서버 행 제한이 작은 경우, 같은 날짜/시각 내역, 중간 페이지 실패, 다른 가구 접근, 같은 링크 재보관과 구입 표시 되돌리기를 검증한다.

## 작업 1: CSV·기간 조회

- [x] `tests/pagination.test.ts`, `tests/components/exportPagination.test.tsx`에서 1,205건·작은 서버 제한·기간·가구·실패를 재현한다.
- [x] `supabase/functions/_shared/pagination.ts`의 `readAllPages<T>(load)`로 실제 받은 수만큼 다음 페이지를 읽는다. 첫 페이지의 전체 개수보다 일찍 끝나면 오류다.
- [x] `src/lib/api.ts`의 기간·두 달·CSV 조회에 적용하고 날짜·시각·ID 정렬을 고정한다.
- [x] `ExportCard`와 `export-csv`가 같은 전체 조회 방식을 사용한다.
- [x] 내보내기 SQL 정렬에 ID를 더하고, DB에서 동률 정렬을 검증한다.

## 작업 2: 보관함 데이터

- [x] `tests/wishesDb.test.ts`에 실제 마이그레이션 기반 공유·격리·권한·유효성 테스트를 먼저 만든다.
- [x] `grocery.purchase_wishes` 마이그레이션을 추가한다. 작성자와 가격 기록은 수정 권한에서 제외한다.
- [x] `src/lib/wishes.ts`에 `Wish`, `WishSeed`, `WishInput`, `WishStore`, `createWishStore(client, householdId)`를 만든다.
- [x] 링크 검증·가격 의미·동일 링크 찾기·CRUD·실시간 재조회 코드를 구현하고 DB·화면 테스트를 확인한다. 운영의 실제 두 기기 간 Realtime 연결은 적용 뒤 확인한다.

## 작업 3: 화면과 연결

- [x] `WishSheet`에 이름·링크·목표 가격·메모 폼과 기존 기록 삭제 동작을 둔다. 구입 표시는 목록에서 한다.
- [x] `src/grocery/components/WishList.tsx`에 보관 중/산 물건 목록과 오류·재시도·작성자를 표시한다.
- [x] `GroceryHome`의 목록/시세 옆에 보관함을 추가하고 사용자별 선택 기억을 확장한다.
- [x] `ExploreView` 검색 결과에서 보관하기를 연결하고, 보관함에서 기존 검색으로 돌아갈 수 있게 한다.
- [x] 모바일·PC 라이트·다크의 보관함·편집·검색 보관 12장, 기존 화면 3장을 캡처했다. 새 화면 12장을 눈으로 확인했다. `/tmp/account-book-wishlist-shots`.

## 작업 4: 마무리

- [x] 사용 설명·결정 기록·준비된 DB 변경과 운영 미적용 상태를 문서화한다.
- [x] 전체 95개 파일 1,128개 테스트·타입 검사·린트·빌드, `export-csv` Deno 타입 검사 통과.
- [x] 독립 코드 리뷰에서 발견한 링크 변경 후 옛 가격 연결과 원 단위 중복을 RED→GREEN으로 수정하고 전체 검증을 다시 통과했다.
- [ ] 공유 DB 적용·배포: 구현·검증을 마쳤고 사용자 확인 대기. 아직 운영에는 적용하지 않는다.
