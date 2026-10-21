-- 원재료 기억 표(D-020, 2026-10-21): 품목(이름·규격 열쇠)마다 식약처 품목제조보고(식품 C002, 축산물 C006, 건강기능식품 C003)에서
-- 상품명으로 자동으로 맞추거나 사람이 고른 원재료를 가구가 기억한다. 상품을 안 고른 품목도 품목 이름으로 찾아 고를 수 있다.
-- 값은 응답 그대로(소비기한·건강기능식품 기능성은 details jsonb). grocery 스키마만 바꾼다(D-003).
-- 쓰기는 Edge Function food-info(서비스 롤)가 set_item_ingredients로만 한다(부른 사람의 가구 품목만). 읽기는 가구 구성원(RLS).
create table grocery.item_ingredients (
  household_id uuid not null references public.households (id) on delete cascade,
  name_key text not null,
  -- 원재료를 받은 목록: C002 식품 품목제조보고, C006 축산물 품목제조보고, C003 건강기능식품 품목제조신고
  origin text not null check (origin in ('C002', 'C006', 'C003')),
  report_no text not null check (char_length(report_no) between 1 and 30),
  name text not null check (char_length(name) between 1 and 200),
  maker text check (char_length(maker) <= 100),
  kind text check (char_length(kind) <= 60),
  raw_materials text check (char_length(raw_materials) <= 4000),
  changed_on date,
  -- shelfLife(소비기한), health(건강기능식품: function·intake·caution), auto(자동 맞춤), matchedBy(product)
  details jsonb not null default '{}'::jsonb,
  chosen_by uuid,
  updated_at timestamptz not null default now(),
  primary key (household_id, name_key),
  foreign key (household_id, chosen_by) references public.members (household_id, user_id) on delete set null (chosen_by)
);

alter table grocery.item_ingredients enable row level security;
create policy item_ingredients_select on grocery.item_ingredients
  for select to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.item_ingredients from public, anon, authenticated;
grant select on grocery.item_ingredients to authenticated;
grant select, insert, update, delete on grocery.item_ingredients to service_role;

-- 품목에 원재료를 저장한다(다시 고르면 덮어쓴다). 서비스 롤만 부른다(함수가 RLS로 부른 사람의 품목인지 먼저 확인한다).
create function grocery.set_item_ingredients(
  p_item uuid, p_origin text, p_report_no text, p_name text, p_maker text, p_kind text, p_raw_materials text, p_changed_on date, p_details jsonb, p_chosen_by uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  it record;
begin
  select household_id, grocery.name_key(name, spec) as k into it from grocery.items where id = p_item;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  insert into grocery.item_ingredients (household_id, name_key, origin, report_no, name, maker, kind, raw_materials, changed_on, details, chosen_by, updated_at)
  values (it.household_id, it.k, p_origin, p_report_no, p_name, p_maker, p_kind, p_raw_materials, p_changed_on, coalesce(p_details, '{}'::jsonb), p_chosen_by, now())
  on conflict (household_id, name_key)
  do update set origin = excluded.origin, report_no = excluded.report_no, name = excluded.name, maker = excluded.maker, kind = excluded.kind,
                raw_materials = excluded.raw_materials, changed_on = excluded.changed_on, details = excluded.details,
                chosen_by = excluded.chosen_by, updated_at = excluded.updated_at;
end;
$$;
revoke execute on function grocery.set_item_ingredients(uuid, text, text, text, text, text, text, date, jsonb, uuid) from public, anon, authenticated;
grant execute on function grocery.set_item_ingredients(uuid, text, text, text, text, text, text, date, jsonb, uuid) to service_role;

-- 내 가구 품목마다 기억한 원재료(같은 이름·규격이면 같은 줄). RLS를 따른다.
create function grocery.item_ingredients_rows()
returns table (item_id uuid, origin text, report_no text, name text, maker text, kind text, raw_materials text, changed_on date, details jsonb, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, g.origin, g.report_no, g.name, g.maker, g.kind, g.raw_materials, g.changed_on, g.details, g.updated_at
    from grocery.items i
    join grocery.item_ingredients g on g.household_id = i.household_id and g.name_key = grocery.name_key(i.name, i.spec)
$$;
revoke execute on function grocery.item_ingredients_rows() from public, anon;
grant execute on function grocery.item_ingredients_rows() to authenticated;
