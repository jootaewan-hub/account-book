# 영수증 품목 줄 고치기 (D-052, v2.28.0)

2026-11-03 저녁, 사용자: "영수증 캡쳐 이후에 세부 항목을 변경 가능하게도 만들어주고 수정도 같이되게". 자동 모드라 설계는 구현자가 정했다.

## 지금까지

- 영수증·쇼핑 캡처 확인 화면(`SmartSheet`의 `DraftCard`)은 품목 줄을 읽기만 보여 주고, 상품 줄의 용량 칸(D-045)만 고칠 수 있었다. 모델이 이름을 틀리거나(추황배 → 주꾸미) 줄을 빠뜨리면 저장 뒤에도 고칠 길이 없었다.
- 저장된 내역의 수정 시트(`EntrySheet`)는 `ItemList`로 품목을 읽기만 보여 주고, `updateTransaction`은 `transactions` 한 줄만 고쳤다.

## 하는 것

1. **`ItemEditor`** (새 컴포넌트, 두 화면이 함께 씀): 줄마다 "고치기" → 이름·수량·금액 칸, "이 줄 빼기", 목록 끝 "품목 합계" 줄과 "품목 줄 더하기"(새 줄은 이름 없음·1개·0원, 바로 열림). 앞 칸(사진)과 아래 칸(용량)은 `renderThumb`·`renderExtra`로 화면이 넘긴다. 결제 금액 `total`을 주면 합계와 다를 때 차이를 적는다(금액을 자동으로 바꾸지 않음 — 영수증 금액은 찍힌 값이고 원단위 절사로 몇 원 다를 수 있다).
2. **`src/lib/itemEdit.ts`** (순수 함수): `withUnitPrice`(수량·금액이 양수면 개당 = 금액 ÷ 수량 반올림, 아니면 null — D-051 접기와 같은 규칙), `parseQuantity`(0보다 큰 수, 소수 셋째 자리까지), `parseAmount`(정수, 쉼표 무시, 음수 허용), `blankItem`, `cleanItems`(이름 다듬기, 빈 줄 빼기, 이름 없이 금액만 있는 줄 번호 알림), `diffItems`(전·후 → insert·update(바뀐 칸만)·remove, sort는 후의 순서).
3. **확인 화면**: `ItemEditor`로 바꾸고 `make`는 `is_product: true`인 빈 줄. 사진 빼기 버튼·용량 칸은 그대로. 고친 품목은 그대로 `saveDraft` → `add_transaction_with_items`로 저장된다.
4. **수정 시트**: 열 때 `editing.items`로 품목 상태를 채우고, 영수증·문자로 넣은 내역(source ≠ manual)은 품목이 없어도 더할 수 있다. 저장 시 `cleanItems`로 막거나 다듬고 `onSave(..., { before, after })`로 넘긴다.
5. **`saveTransactionItems(txId, householdId, change)`** (`api.ts`): `diffItems` 결과만 반영 — 뺀 줄 delete(+사진 `removeItemImages`), 바뀐 줄 update, 새 줄 insert(`transaction_id`·`household_id` 붙임). `App.save`가 `updateTransaction` 다음에 부른다. DB 변경 없음: `transaction_items`는 init 마이그레이션에서 가구 RLS(`transaction_items_all`)와 select·insert·update·delete grant가 이미 열려 있고, `grocery.purchase_verdicts`는 item 삭제에 cascade.
6. 읽기 전용 `ItemList`는 지웠다(수정 시트에서만 쓰였음).

## 하지 않는 것

- 개당 가격 직접 입력(수량·금액으로 센다), 품목에 맞춰 결제 금액 자동 수정, 손으로 넣은 내역에 품목 더하기(품목이 있을 때만 보임), 품목 사진 바꾸기, 줄 순서 바꾸기.

## 시험

- `tests/itemEdit.test.ts`: 개당 가격, 글자 읽기, 정리, 차이(순서만 바뀜·칸 고침·새 줄·뺀 줄·용량만).
- `tests/components/itemEditor.test.tsx`(jsdom): 고치기 열기, 금액·수량 고치면 개당 다시 세기와 잘못된 수량 안내, 줄 빼기·더하기, 결제 금액 차이 문장, 앞·아래 칸 렌더.
- 캡처: `shell-smart-item-edit-390-*`, `shell-entry-items-390-*`(새 장면), `shell-smart-items-*`, `shell-entry-batch-1280-light`.

## 운영 반영

- 화면만 바뀐다(함수·DB 없음). main 병합·푸시는 사용자 승인 뒤.
