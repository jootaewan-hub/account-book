-- 화면에 없는 기능 정리: 정산 기록 표와 공동 지출 분담 비율.
-- 둘 다 쓰는 화면이 없고 데이터도 없다 (2026-10-16 기준 정산 0건, 비율은 모두 기본값 0.50).
-- 표를 지우면 RLS 정책·권한·realtime publication 등록도 함께 없어진다.
-- 결제수단 표(payment_methods)는 예전 내역과 반복 항목이 가리키고 있어 그대로 둔다 (앱에서 고르지는 않음).
drop table public.settlements;
alter table public.households drop column share_ratio;
