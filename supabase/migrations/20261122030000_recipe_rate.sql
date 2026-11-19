-- 레시피 서버 함수(recipe-worker)의 요청 횟수 한도. 설계 §10·§11 "요청 크기와 횟수에 한도".
-- 비밀을 확인한 요청만 센다(서버 함수가 비밀 검사 뒤에 recipe.worker_rate_hit을 부른다). 한 분(UTC로 분 단위에 맞춘 고정 창)에 120번까지.
-- 줄 하나만 갈아 끼우는 꼴이라 쌓이는 것이 없고 지울 일도 없다(그래서 이 파일에 삭제 문장이 없다).
create table recipe.worker_calls (
  id int primary key default 1 check (id = 1),
  window_start timestamptz not null,
  calls int not null check (calls >= 0)
);
insert into recipe.worker_calls (id, window_start, calls) values (1, '-infinity', 0);

alter table recipe.worker_calls enable row level security;
-- 정책 없음: 서비스 롤만(RLS를 건너뜀) 읽고 쓴다.
revoke all on recipe.worker_calls from anon, authenticated;
grant select, update on recipe.worker_calls to service_role;

-- 이번 요청을 세고, 한도 안이면 true. 한 문장으로 세므로 동시에 불러도 틀어지지 않는다. 시각은 부르는 쪽이 준다(p_now).
create function recipe.worker_rate_hit(p_now timestamptz, p_limit int)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_calls int;
begin
  if p_now is null or p_limit is null then
    raise exception 'recipe_rate_args_required' using errcode = '22004';
  end if;
  update recipe.worker_calls
     set calls = case when window_start = date_trunc('minute', p_now) then calls + 1 else 1 end,
         window_start = date_trunc('minute', p_now)
   where id = 1
  returning calls into v_calls;
  return v_calls <= p_limit;
end;
$$;

revoke execute on function recipe.worker_rate_hit(timestamptz, int) from public, anon, authenticated;
grant execute on function recipe.worker_rate_hit(timestamptz, int) to service_role;
