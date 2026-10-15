-- 7단계: 기념일. 생일·결혼기념일처럼 해마다 돌아오는 날을 양력 또는 음력 월·일로 저장해 달력에 표시한다.
-- 저장소가 공개라 가족 기념일은 코드가 아니라 이 표(가구 구성원만 읽음)에 둔다.

create table public.anniversaries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  -- birthday 생일, couple 우리 둘(처음 만난 날·결혼기념일 등), memorial 추모, other 그 밖
  kind text not null default 'other' check (kind in ('birthday', 'couple', 'memorial', 'other')),
  -- true면 음력 월·일 (윤달이 아닌 달 기준)
  lunar boolean not null default false,
  month smallint not null check (month between 1 and 12),
  day smallint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (day >= 1 and day <= case when lunar then 30 when month = 2 then 29 when month in (4, 6, 9, 11) then 30 else 31 end)
);
create index anniversaries_household_id_idx on public.anniversaries (household_id);
create index anniversaries_created_by_idx on public.anniversaries (created_by);
create trigger anniversaries_touch_updated_at
before update on public.anniversaries
for each row execute function private.touch_updated_at();

alter table public.anniversaries enable row level security;
create policy anniversaries_all on public.anniversaries
  for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
revoke all on public.anniversaries from anon;
grant select, insert, update, delete on public.anniversaries to authenticated;
grant select, insert, update, delete on public.anniversaries to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.anniversaries;
  end if;
end;
$$;
