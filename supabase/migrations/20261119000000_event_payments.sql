create table public.event_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  event_id uuid not null,
  transaction_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  amount bigint not null check (amount between 1 and 9999999999),
  due_on date,
  updated_at timestamptz not null default now(),
  foreign key (event_id, household_id) references public.events(id, household_id) on delete cascade,
  foreign key (transaction_id, household_id) references public.transactions(id, household_id) on delete set null (transaction_id),
  unique (event_id, transaction_id)
);
create index event_payments_event_idx on public.event_payments(event_id, household_id);
create index event_payments_transaction_idx on public.event_payments(transaction_id, household_id) where transaction_id is not null;
create index event_payments_due_idx on public.event_payments(household_id, due_on) where transaction_id is null;
create trigger event_payments_touch before update on public.event_payments
for each row execute function private.touch_updated_at();

alter table public.event_payments enable row level security;
create policy event_payments_member on public.event_payments for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
revoke all on public.event_payments from public, anon, authenticated;
grant select, delete on public.event_payments to authenticated;
grant insert (household_id, event_id, transaction_id, title, amount, due_on),
  update (transaction_id, title, amount, due_on) on public.event_payments to authenticated;
