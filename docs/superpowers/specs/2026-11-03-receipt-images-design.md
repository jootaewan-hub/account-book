# 영수증 사진 저장과 다시 읽기 (D-053, v2.29.0)

2026-11-03 밤, 사용자가 "이미 촬영한 오늘 이마트 영수증을 다시 분석해 달라"고 했으나 사진이 어디에도 남아 있지 않아 못 했다. 자동 모드라 설계는 구현자가 정했다(브리프: 사진 저장, 수정 시트에서 보기·지우기·다시 읽기, 삭제 시 정리).

## 지금까지

- 영수증 사진은 기기에서 줄인 JPEG(`fileToJpeg`, 긴 변 2400px·4,784토큰 안)를 `extract-entries`에 보내고 버린다. `transactions.receipt_path` 칸은 init 마이그레이션부터 있고 update grant도 있으나 아무도 쓰지 않았다.
- 쇼핑 캡처의 상품 사진 조각만 `item-images` 버킷(가구 폴더, `private.storage_household_ok`)에 올린다.

## 하는 것

1. **저장소**: 새 비공개 버킷 `receipt-images`(JPEG만, 한 장 3MB). 정책은 `item-images`와 같이 `private.storage_household_ok(name)`로 가구 구성원만 읽기·올리기·지우기. `transactions.receipt_path`에 길이 검사(200자)와 부분 색인을 더한다. 마이그레이션 `20261114000000_receipt_images.sql`(적용은 사용자 승인 뒤).
2. **경로**: 한 영수증의 사진은 `<가구 id>/<내역 id>/<n>.jpg`(n은 1부터, 그 내역을 읽은 사진 순서). `receipt_path`에는 폴더 `<가구 id>/<내역 id>`를 적는다. 상품별로 나눠 저장한 내역(save_batch)은 첫 내역 폴더에 한 번만 올리고 모든 내역이 같은 폴더를 가리킨다.
3. **저장**(`SmartSheet.saveAll`, 영수증 모드만): 내역을 먼저 저장하고(`saveDraft` → `add_transaction_with_items`), 묶음마다 그 묶음을 읽은 사진(`entry.images`, 없으면 사진이 한 장일 때만 그 한 장)을 올린 뒤 `update transactions set receipt_path` 한다(`setReceiptPath`). 사진 올리기가 하나라도 실패하면 올린 것을 지우고 `receipt_path`는 비워 두며 알림 끝에 "영수증 사진은 저장하지 못했어요"를 붙인다. 내역 저장은 되돌리지 않는다. 쇼핑 캡처·고지서·문자는 올리지 않는다.
4. **보기**(`EntrySheet`): `receipt_path`가 있으면 "영수증 사진" 칸에 폴더의 파일을 번호 순으로 썸네일(72px)로 보이고, 누르면 `PhotoViewer`(전체 화면, 어두운 바탕, 닫기·Esc)로 크게 본다. "사진 지우기"는 두 번 누르기 확인 뒤 폴더 파일을 지우고 같은 폴더를 가리키는 내역 모두의 `receipt_path`를 비운다.
5. **다시 읽기**(`EntrySheet` → `rereadReceipt`): 저장된 사진을 내려받아 `fileToJpeg`로 다시 줄여 `analyzeImages(…, 'receipt', today)`에 보낸다(여러 장이면 D-029 잇기가 그대로 동작). 돌아온 내역 가운데 결제 금액이 같은 것(없으면 첫 것)의 품목을 `mergeReread`로 저장된 줄과 이름이 같으면 id를 이어받게 맞춰 `ItemEditor`에 채운다. 사용자가 확인하고 저장하면 기존 `saveTransactionItems`가 전·후 차이만 반영한다. 읽은 결제 금액이 저장된 금액과 다르면 그 아래 "다시 읽은 영수증의 결제 금액은 N원이에요. 저장된 금액 M원은 바꾸지 않았어요"만 적고 금액은 건드리지 않는다. "읽기 전 품목으로 되돌리기"로 저장 전에 되돌릴 수 있다. 진행 중 버튼 글자는 "영수증 사진 읽는 중…".
6. **삭제**(`deleteTransaction`·`deleteTransactions`): 지울 내역의 `receipt_path`를 먼저 읽고, 지운 뒤 같은 폴더를 가리키는 내역이 하나도 남지 않았을 때만 폴더 파일을 지운다(`removeUnusedReceiptImages`). 사진 삭제가 실패해도 내역 삭제는 그대로다.
7. **읽기**: 월 내역 읽기 칸(`TX_COLUMNS`)에 `receipt_path`를 더한다. 목록 화면에는 보이지 않는다.

## 하지 않는 것

- 쇼핑 캡처·고지서·문자 입력의 사진 보관(쇼핑은 상품 사진 조각만 그대로), 원본 크기 보관(분석에 쓴 축소 JPEG만), 사진 바꾸기·더 넣기(지우고 새 영수증으로 넣는다), 다시 읽기로 날짜·가게·금액 자동 수정, 지난 내역의 사진 복원(저장된 적이 없다).

## 시험

- `tests/receiptImages.test.ts`: 경로·번호 정리(`receiptFolder`, `receiptImagePaths`, `receiptImageIndexes`), 가짜 `sb()`로 올리기 경로·실패 시 되돌리기, 쓰지 않는 폴더만 지우기, `receipt_path` 비우기.
- `tests/itemEdit.test.ts`: `mergeReread`(이름이 같으면 id 유지, 새 줄, 두 번 나온 같은 이름).
- `tests/db.test.ts`: 버킷 정책(자기 가구만 올리기·보기·지우기), `receipt_path` 수정 권한과 길이 검사.
- `tests/components/entrySheetReceipt.test.tsx`(jsdom): 썸네일·크게 보기, 사진 지우기 두 번 누르기, 다시 읽기 뒤 품목 채움과 금액 차이 문장, 저장 시 전·후 넘김.
- 캡처: `shell-entry-receipt-*`(390·1280, 라이트·다크), `shell-entry-receipt-view-390-*`, `shell-entry-reread-390-*`.

## 운영 반영

- 순서: 마이그레이션(버킷·정책) → main 병합·푸시. 버킷 전에 새 화면이 올라가면 사진 올리기만 실패하고(내역 저장은 됨) 알림으로 알린다. 서버 함수 변경 없음.
