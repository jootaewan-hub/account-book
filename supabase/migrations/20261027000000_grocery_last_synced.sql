-- P8(열린 문제): 식약처·시세·참가격 확인 상태는 서비스별 "마지막 성공 실행" 시각이어야 한다. 앱이 최근 30건만 읽어 고르면
-- 한 서비스가 오래 실패했을 때 그 서비스가 30건 밖으로 밀려 "확인한 범위"에서 빠졌다. 서비스마다 ok=true인 가장 늦은 ran_at을 돌려준다.
-- 로그인한 사용자 누구나(sync_runs 읽기 권한과 같다). grocery 스키마만(D-003).
create function grocery.last_synced()
returns table (source text, ran_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.source, max(r.ran_at) as ran_at
    from grocery.sync_runs r
   where r.ok
   group by r.source
$$;
revoke execute on function grocery.last_synced() from public, anon;
grant execute on function grocery.last_synced() to authenticated;
