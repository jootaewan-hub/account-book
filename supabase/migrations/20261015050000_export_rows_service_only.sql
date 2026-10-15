-- 내보내기 함수는 Edge Function(export-csv)이 service role로만 부른다.
-- 공개 API(/rest/v1/rpc/export_rows)로는 토큰을 맞혀 보는 시도조차 못 하게 막는다.
revoke execute on function public.export_rows(text) from anon, authenticated;
grant execute on function public.export_rows(text) to service_role;
