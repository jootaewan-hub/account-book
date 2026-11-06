create table public.household_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  due_on date not null,
  assignee_id uuid,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (household_id, assignee_id) references public.members(household_id, user_id) on delete set null (assignee_id)
);
create index household_tasks_due_idx on public.household_tasks(household_id, due_on, id);

create function private.touch_household_task()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.completed_at is null then
    new.completed_by := null;
  elsif tg_op = 'INSERT' or old.completed_at is null then
    new.completed_at := now();
    new.completed_by := auth.uid();
  else
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  return new;
end;
$$;
revoke execute on function private.touch_household_task() from public, anon, authenticated;
create trigger household_tasks_touch before insert or update of title, due_on, assignee_id, completed_at on public.household_tasks
for each row execute function private.touch_household_task();

alter table public.household_tasks enable row level security;
create policy household_tasks_member on public.household_tasks for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
revoke all on public.household_tasks from public, anon, authenticated;
grant select, delete on public.household_tasks to authenticated;
grant insert (household_id, title, due_on, assignee_id), update (title, due_on, assignee_id, completed_at)
  on public.household_tasks to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.household_tasks;
  end if;
end;
$$;
