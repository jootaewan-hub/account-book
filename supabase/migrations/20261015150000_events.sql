-- 9단계: 일정. 병원 예약·모임처럼 한 번 있는 일을 날짜(시간은 선택)로 저장해 달력에 표시한다.
-- 해마다 돌아오는 날은 기념일(anniversaries) 표를 쓴다.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  date date not null,
  -- null이면 하루 종일
  time time,
  title text not null check (char_length(btrim(title)) between 1 and 40),
  memo text check (char_length(memo) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_household_date_idx on public.events (household_id, date);
create index events_created_by_idx on public.events (created_by);
create trigger events_touch_updated_at
before update on public.events
for each row execute function private.touch_updated_at();

alter table public.events enable row level security;
create policy events_all on public.events
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;
grant select, insert, update, delete on public.events to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.events;
  end if;
end;
$$;
