-- 함께 살 물건 보관함. 당장 살 장보기 목록과 분리하고 가구 구성원끼리 공유한다.
-- grocery 스키마만 바꾼다(D-003). 가계부 지출은 자동으로 만들지 않는다.
create table grocery.purchase_wishes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  url text check (char_length(url) <= 2000 and url ~ '^https?://[^[:space:]]+$'),
  target_price bigint check (target_price > 0 and target_price < 10000000000),
  memo text check (char_length(memo) <= 500),
  saved_price bigint check (saved_price > 0 and saved_price < 10000000000),
  price_source text check (char_length(btrim(price_source)) between 1 and 40),
  price_checked_at timestamptz,
  price_note text check (char_length(price_note) <= 200),
  bought_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((saved_price is null and price_source is null and price_checked_at is null and price_note is null)
    or (saved_price is not null and price_source is not null and price_checked_at is not null and price_note is not null))
);
create index purchase_wishes_household_idx on grocery.purchase_wishes(household_id, created_at desc, id desc);
create index purchase_wishes_created_by_idx on grocery.purchase_wishes(created_by);
create unique index purchase_wishes_household_url_key on grocery.purchase_wishes(household_id, url) where url is not null;
create trigger purchase_wishes_touch_updated_at before update on grocery.purchase_wishes
  for each row execute function private.touch_updated_at();

-- 상품 링크가 바뀌면 다른 상품의 옛 가격을 붙이지 않는다. 사용자는 가격 칸 자체를 수정할 수 없다.
create function grocery.clear_wish_price_on_link_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.url is distinct from old.url then
    new.saved_price := null;
    new.price_source := null;
    new.price_checked_at := null;
    new.price_note := null;
  end if;
  return new;
end;
$$;
revoke execute on function grocery.clear_wish_price_on_link_change() from public, anon, authenticated;
create trigger purchase_wishes_clear_old_price before update of url on grocery.purchase_wishes
  for each row execute function grocery.clear_wish_price_on_link_change();

alter table grocery.purchase_wishes enable row level security;
create policy purchase_wishes_select on grocery.purchase_wishes for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy purchase_wishes_insert on grocery.purchase_wishes for insert to authenticated
  with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy purchase_wishes_update on grocery.purchase_wishes for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy purchase_wishes_delete on grocery.purchase_wishes for delete to authenticated
  using ((select private.is_household_member(household_id)));

revoke all on grocery.purchase_wishes from public, anon, authenticated;
grant select, insert, delete on grocery.purchase_wishes to authenticated;
-- 작성자·가구·보관 당시 가격 기록은 사용자 업데이트로 바뀌지 않는다.
grant update(title, url, target_price, memo, bought_at) on grocery.purchase_wishes to authenticated;
grant select, insert, update, delete on grocery.purchase_wishes to service_role;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table grocery.purchase_wishes;
  end if;
end $$;
