-- 로그인하지 않은 사용자(anon)는 가계부 표에 아예 권한이 없게 한다. (RLS가 이미 막지만 처음 표들과 같은 기준으로)
revoke all on public.recurring, public.settlements, public.utility_bills from anon;
