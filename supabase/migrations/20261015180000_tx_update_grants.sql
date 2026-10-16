-- 내역 수정 권한: init에서 칸 단위로 준 UPDATE 목록에, 나중에 생긴 칸이 빠져 있었다.
-- 앱은 내역을 고칠 때 platform을 늘 함께 보내고(20261015080000_platform_units),
-- 관리비 고지서를 다시 저장할 때는 recurring_id·recurring_month로 고정지출에 잇는다(20261015040000_recurring_stats_export).
-- 한 칸이라도 권한이 없으면 수정 전체가 'permission denied for table transactions'로 거절된다.
-- recurring_id는 (recurring_id, household_id) 외래키라 같은 가구의 고정지출에만 이을 수 있다.
grant update (platform, recurring_id, recurring_month) on public.transactions to authenticated;
