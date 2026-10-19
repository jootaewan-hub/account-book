# SDD ledger — plan: docs/superpowers/plans/2026-10-19-remaining-work.md
Scope: P3 세부 계획(P3-1 ~ P3-7). 브랜치 claude/p3-price-sources (main e8deac2 + 문서 커밋 605375a에서 시작).
Setup: Ruling: 워크트리 대신 같은 작업 트리의 새 브랜치 — node_modules(PGlite·playwright)가 무겁고 트리가 깨끗함 — 비용: 없음(브랜치만 쓰면 됨).
Setup: Ruling: task-start/task-done 스크립트는 "### Task N" 제목만 읽는데 P3 계획은 체크박스 묶음이라 ledger를 손으로 쓴다(형식은 같게) — 비용: 없음.
Setup: 시험 기준선 npm test → 591/591, npx tsc --noEmit → 0.
Pre-flight: P3-1(shops.ts) → P3-4(product-check가 부름): 타입은 P3-1이 정함. P3-2(tprice.ts) → P3-4(tprice-sync). P3-3(DB) → P3-4·P3-5. 충돌 없음(코드가 아직 없음).
Pre-flight: Ruling: 스펙(price-check-design.md)은 D-013 이후 바뀐 점(에누리 뺌, 주소 붙여넣기)을 반영하지 않음 — D-013·세부 계획을 우선 — 비용: 스펙 문장과 어긋나는 부분은 상태 문서에 적는다.
Task P3-1: complete (commits 605375a..e72cf0a, tests: npm test →  Tests 605 passed (605))
Task P3-2: Ruling: 요청 goodInspectDay는 YYYYMMDD로 보낸다(명세에 보기 없음, 공공데이터포털 관례) — 응답 날짜는 YYYYMMDD·YYYY-MM-DD 둘 다 읽음 — 비용: 틀리면 첫 수집 때 resultCode로 드러나고 한 줄 고침(P3-6에서 확인).
Task P3-2: Ruling: 상품 항목 태그는 명세의 item과 iros.openapi.service.vo.* 둘 다 행으로 읽고, 상세내용은 detailMean·datailMean(명세 오타) 둘 다 읽는다 — 비용: 없음.
Task P3-2: complete (commits e72cf0a..7c2b713, tests: npm test →  Tests 618 passed (618))
Task P3-3: Ruling: shop_links는 (가구, 상품, 출처)마다 하나(출처당 주소 하나) — 화면이 '출처 태그'로 보여 주므로 — 비용: 같은 몰의 두 상품을 다 넣고 싶으면 뒤에 열쇠를 넓혀야 함.
Task P3-3: Ruling: tprice_prices는 판매점·상품 FK를 둔다(모르는 상품의 가격은 수집 함수가 거른다) — 비용: 없음.
Task P3-3: marketDb·foodAlertsDb 시험의 잠금 행 기대값([1,2]→[1,2,3], 거절되는 id 3→4)을 고침(id 3 추가가 의도).
Task P3-3: complete (commits 7c2b713..19d8420, tests: npx vitest run --exclude P3-4 RED 두 파일 →  Tests 626 passed (626))
Task P3-4: Ruling: sanitize·kstDate를 _shared/sync.ts로 옮기고 market-sync/handle.ts는 다시 내보낸다(복제 대신) — 비용: 없음(시세 시험 그대로 통과).
Task P3-4: Ruling: 가격 호출은 성남 판매점 × 최근 금요일 5개 중 아직 행이 없는 쌍(최대 75회/일, 한도 2,000) — 격주라 빈 금요일은 매일 다시 묻는다 — 비용: 하루 수십 회 빈 호출.
Task P3-4: complete (commits 19d8420..29bf82a, tests: npm test →  Tests 654 passed (654))
Task P3-4: 보안 리뷰 반영: shop_links.url을 (source, source_id)에서 만든 값과 같도록 check, 함수는 shopUrl()로 주소를 다시 만듦 (commit 496748f, tests: npm test →  Tests 656 passed (656))
Task P3-5: complete (commits 496748f..f25a12d, tests: npx vitest run --exclude P2 RED →  Tests 680 passed (680); 캡처 11장 눈으로 확인)
Task P3-7: complete (commit 65d0a6c, tests: same run)
Task P2-1: Ruling: 마이그레이션 이름은 계획의 20261021010000 대신 20261024000000(P3 파일 20261023000000보다 뒤여야 함) — 비용: 없음.
Task P2-1: Ruling: 단어 나누기는 _alert_hits 규칙을 grocery.name_tokens()로 복사(기존 함수는 안 건드림) — 비용: 규칙을 바꾸면 두 곳.
Task P2-1: complete (commit 73add07, tests: npm test →  Tests 687 passed (687))
Task P2-2: complete (commit 8a4b84e, tests: npm test → 692/692; 캡처 3장 눈으로 확인)
Task P4: Ruling: 모델은 claude-sonnet-5-5(계획이 가계부와 같은 Haiku/Sonnet 5.5를 쓴다고 명시; 작은 글씨 캡처) — 비용: 읽기 품질이 모자라면 Opus 5.5로 바꾸면 됨.
Task P4: Ruling: list 일(사진으로 담기)은 P6에서 더한다(계획이 P6에 둠) — 비용: 없음.
Task P4: complete (commit cb204c7, tests: npm test → 705/705; 캡처 6장 눈으로 확인; WIF 첫 호출은 배포 뒤 사용자 확인)
Task P6: Ruling: 바코드 읽기는 내장 BarcodeDetector → barcode-detector 포니필(MIT, wasm 번들), CSP script-src에 'wasm-unsafe-eval' 추가 — 외부 스크립트는 여전히 금지 — 비용: 번들 자산 1.1MB(읽을 때만 로드).
Task P6: Ruling: 매대 앞 확인은 품목 상세 대신 바코드 시트(식약처 대조 → 다나와 검색 새 창 → 담기)로 — product-search가 품목 단위라 담지 않은 상품의 상세를 열 수 없음 — 비용: 가격 확인은 담은 뒤에.
Task P6: complete (commit f1c1c6e, tests: npm test →  Tests 734 passed (734); 캡처 8장 눈으로 확인; 실기기 바코드 10개는 사용자)
Task P7-1: complete (commit f80e6ed, tests: same run; 영양성분DB는 명세로만 확인 — 실제 호출은 키 활용신청 뒤)
Task P7-2: Ruling: product_info는 (가구, 상품) 단위(보안 리뷰: 공용이면 한 가구의 선택이 다른 가구 화면을 바꿈) — 비용: 가구마다 따로 골라야 함.
Task P7-2: Ruling: 대안 탭은 다나와 후보의 같은 수량 가격·평점(0.2 이상, 후기 100개 이상)만 견주고, 후보의 회수·부적합 대조는 안 함(확정할 결정) — 비용: 회수된 후보가 대안에 뜰 수 있음(안내 문구 있음).
Task P7-2: complete (commit 050155f, tests: npm test → 743/743; 캡처 6장 눈으로 확인)
Task P8-1: complete (commit a54a299, tests: same run)
Task P8-2: complete (commit 5d922bf, tests: npm test →  Tests 743 passed (743); 셸 상세 캡처 눈으로 확인)
Task P8: Ruling: 빼기 되돌리기 합치기·Realtime DELETE 두 기기 확인·I2715 알림 피로는 사용자와 정할 일이라 status '확정할 결정'에 적고 손대지 않음 — 비용: 없음.
Final review: 새 컨텍스트 리뷰어(fable) — Critical 0, Important 5, Minor 9. 재평가: Important 5 유지, Minor 9(wasm 경로 설치 의존)는 빌드가 깨질 수 있어 Important로 올림.
Final: fixed our_purchases linked 줄 고르기(단어 0개·여러 줄이면 총액 줄, paid와 같은 줄 우선) — ourPurchasesDb '이름 단어가 하나도 안 맞으면…' RED→GREEN
Final: fixed 사진 읽기 "AI" 문구 — photo.test '사진 읽기 오류 문구' RED→GREEN(photoErrorText), 서버 문구도 바꿈
Final: fixed 대안 줄 기준일 — alternatives.test foundAt RED→GREEN, 화면에 "다나와, 시각 확인"
Final: fixed 바코드 "다른 바코드 읽기" 카메라 재시작, 대조 실패를 "기록 없음"으로 그리지 않음 — React 컴포넌트 시험 틀이 없어 RED→GREEN 대신 tsc·캡처(기록·없음 화면)로 확인
Final: fixed zxing-wasm 명시 의존성(package.json) — 시험 없음(설치 구조)
Final: minor (deferred): price-recheck가 안 산 상품 18개를 넘으면 뒤쪽 상품이 매일 미뤄짐(마지막 확인 오래된 순 정렬 권장)
Final: minor (deferred): food-info index의 user.auth.getUser()에 jwt를 안 넘겨 chosen_by가 항상 null일 수 있음(getUser(jwt) 또는 getClaims)
Final: minor (deferred): barcode.ts가 UPC-E 8자리를 EAN-8 검사 숫자로 검사해 실제 UPC-E를 거부할 수 있음
Final: minor (deferred): ItemDetail 다나와 실패 문구의 시각이 lines[0](캡처 줄일 수 있음)을 씀
Final: minor (deferred): 목록 줄의 캡처 가격은 "캡처", 상세는 "캡처(이름)"로 표기가 다름
Final: minor (deferred): tprice-sync에서 성남 판매점이 0개면 .in('entp_id', [])로 500(기록 없음) 가능
Final: minor (deferred): OursBlock "누군가" 표현을 가계부 쪽과 맞추기
Final: minor (deferred): 겹쳐 연 시트(Frame)가 닫힌 뒤 포커스가 트리거 버튼으로 돌아오지 않음
Final: Ruling: shop_checks·product-check의 공용 캐시(다른 가구가 넣은 출처 id가 보임) — 계획·D-013의 공용 캐시 설계 그대로 — 비용: 출처 id 노출(값은 공개 페이지).
Final: Ruling: .price-src 등 12px 한글 — P3 이전부터, status 열린 문제에 기록 — 비용: DESIGN 규칙과 어긋남 지속.
Final: Ruling: 계획 P3의 "어디서 살지 보기"·설정 묶음·source_links 맞아요/아니에요·price_checks.source 확장·I2810은 D-013에서 바뀌었거나 사용자 활용신청 대기라 하지 않음 — 비용: 없음.
Final: Ruling: P7 후보의 회수·부적합 대조 미구현(확정할 결정), P6 매대 앞 확인은 바코드 시트 — 앞선 룰링 그대로.
Final: Ruling: goodInspectDay 모양·영양성분DB 응답 모양은 첫 호출 전 판단 불가(확인 필요로 기록).
Final: Ruling: AddSheet→바코드 전환의 닫기 애니메이션 생략, 데모·셸 fixture는 캡처 전용 — 손대지 않음.
