-- 함께 기억할 것(D-038). 부부가 날짜 없이 기억해 둘 것(관리사무소 번호, 필터 교체 주기, 양가 선물 취향 등)을 적는 가구 공동 메모.
-- 날짜가 있는 일은 일정(events)·기념일(anniversaries), 살 물건은 보관함(grocery.purchase_wishes)을 쓴다.
-- 내보내기(export-csv)에는 넣지 않는다: 로그인 없이 부르는 주소라 RLS 밖으로 나간다.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  body text check (char_length(body) <= 2000),
  -- 고정한 것은 목록 맨 위와 달력 화면에 보인다
  pinned boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  -- 제목·내용을 마지막으로 고친 사람과 때. 고정만 바꾸면 그대로 둔다(아래 트리거)
  updated_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_household_idx on public.notes (household_id, pinned desc, updated_at desc, id desc);
create index notes_created_by_idx on public.notes (created_by);
create index notes_updated_by_idx on public.notes (updated_by);

-- 고친 사람은 로그인한 사람으로만 남는다(앱이 보내는 값을 믿지 않는다)
create function private.touch_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.title, new.body) is not distinct from (old.title, old.body) then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  else
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by, new.created_by);
  end if;
  return new;
end;
$$;
revoke execute on function private.touch_note() from public, anon, authenticated;
create trigger notes_touch before insert or update on public.notes
for each row execute function private.touch_note();

alter table public.notes enable row level security;
create policy notes_select on public.notes for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy notes_insert on public.notes for insert to authenticated
  with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy notes_update on public.notes for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy notes_delete on public.notes for delete to authenticated
  using ((select private.is_household_member(household_id)));

revoke all on public.notes from public, anon, authenticated;
grant select, insert, delete on public.notes to authenticated;
-- 가구·작성자·고친 사람은 사용자 업데이트로 바뀌지 않는다
grant update (title, body, pinned) on public.notes to authenticated;
grant select, insert, update, delete on public.notes to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notes;
  end if;
end;
$$;
