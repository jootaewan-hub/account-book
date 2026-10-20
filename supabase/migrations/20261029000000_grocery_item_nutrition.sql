-- 영양성분 이름 검색(P9, D-018, 2026-10-20): 품목(이름·규격 열쇠)마다 식품영양성분DB(공공데이터포털 15127578)에서 사람이 고른 식품을 가구가 기억한다.
-- 신선 품목처럼 다나와 상품이 없어도 열량·영양성분을 볼 수 있게 한다. 값은 API 응답 그대로(jsonb). grocery 스키마만 바꾼다(D-003).
-- 쓰기는 Edge Function food-info(서비스 롤)가 set_item_nutrition으로만 한다(부른 사람의 가구 품목만). 읽기는 가구 구성원(RLS).
create table grocery.item_nutrition (
  household_id uuid not null references public.households (id) on delete cascade,
  name_key text not null,
  food_cd text check (char_length(food_cd) <= 30),
  food_name text not null check (char_length(food_name) between 1 and 200),
  maker text check (char_length(maker) <= 100),
  -- _shared/foodInfo.ts의 NutritionRow 모양 그대로(열량·탄수화물·…·기준량·출처·갱신일)
  nutrition jsonb not null,
  chosen_by uuid,
  updated_at timestamptz not null default now(),
  primary key (household_id, name_key),
  foreign key (household_id, chosen_by) references public.members (household_id, user_id) on delete set null (chosen_by)
);

alter table grocery.item_nutrition enable row level security;
create policy item_nutrition_select on grocery.item_nutrition
  for select to authenticated
  using ((select private.is_household_member(household_id)));
revoke all on grocery.item_nutrition from public, anon, authenticated;
grant select on grocery.item_nutrition to authenticated;
grant select, insert, update, delete on grocery.item_nutrition to service_role;

-- 품목에 식품을 고른다(다시 고르면 덮어쓴다). 서비스 롤만 부른다(함수가 RLS로 부른 사람의 품목인지 먼저 확인한다).
create function grocery.set_item_nutrition(p_item uuid, p_food_cd text, p_food_name text, p_maker text, p_nutrition jsonb, p_chosen_by uuid)
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
  insert into grocery.item_nutrition (household_id, name_key, food_cd, food_name, maker, nutrition, chosen_by, updated_at)
  values (it.household_id, it.k, p_food_cd, p_food_name, p_maker, p_nutrition, p_chosen_by, now())
  on conflict (household_id, name_key)
  do update set food_cd = excluded.food_cd, food_name = excluded.food_name, maker = excluded.maker, nutrition = excluded.nutrition,
                chosen_by = excluded.chosen_by, updated_at = excluded.updated_at;
end;
$$;
revoke execute on function grocery.set_item_nutrition(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function grocery.set_item_nutrition(uuid, text, text, text, jsonb, uuid) to service_role;

-- 내 가구 품목마다 기억한 식품(같은 이름·규격이면 같은 줄). RLS를 따른다.
create function grocery.item_nutrition_rows()
returns table (item_id uuid, food_cd text, food_name text, maker text, nutrition jsonb, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, n.food_cd, n.food_name, n.maker, n.nutrition, n.updated_at
    from grocery.items i
    join grocery.item_nutrition n on n.household_id = i.household_id and n.name_key = grocery.name_key(i.name, i.spec)
$$;
revoke execute on function grocery.item_nutrition_rows() from public, anon;
grant execute on function grocery.item_nutrition_rows() to authenticated;
