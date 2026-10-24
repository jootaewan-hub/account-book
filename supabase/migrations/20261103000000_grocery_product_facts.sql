-- 상품명 → 식약처 품목 맞춤 다시 만들기(D-026, 설계 docs/superpowers/specs/2026-10-23-product-match-design.md).
-- grocery 스키마만 바꾼다(D-003).
--
-- 1) 다나와 상품 페이지에서 읽은 제조사·상표·원산지·원재료명. 식약처 업체명은 상표가 아니라 제조사로 적혀 있다(청정원 → 대상(주), 큐원 → (주)삼양사).
--    product-check·price-recheck·food-info가 페이지를 읽을 때 서비스 롤로 쓴다. 상품 표 읽기 권한(authenticated select)은 표 단위라 새 칸에도 그대로다.
alter table grocery.products
  add column maker text check (char_length(maker) <= 60),
  add column brand text check (char_length(brand) <= 60),
  add column origin text check (char_length(origin) <= 200),
  add column materials text check (char_length(materials) <= 200),
  add column facts_at timestamptz;

comment on column grocery.products.maker is '다나와 makerName(제조사). 식약처 업체명(BSSH_NM) 조건에 쓴다';
comment on column grocery.products.origin is '다나와 JSON-LD 설명의 "원산지: …" 그대로';
comment on column grocery.products.materials is '다나와 JSON-LD 설명의 "원재료명: …" 그대로';
comment on column grocery.products.facts_at is 'maker·brand·origin·materials를 마지막으로 읽은 시각(값이 없어도 읽었으면 채운다)';

-- 2) 자동 맞춤은 사람이 고른 줄을 덮지 않는다. 지금까지는 화면이 저장된 줄이 없을 때만 자동 맞춤을 불렀지만,
--    이제 옛 버전 자동 줄을 다시 맞추므로(원재료는 사람이 고르고 영양은 옛 자동인 품목 등) 저장 함수에서 막는다.
--    들어오는 줄이 자동(auto true)이고 있는 줄이 자동이 아니면(사람이 고름, auto 표시가 없는 옛 줄) 그대로 둔다. 본문은 이전 정의와 같고 where만 더했다.
create or replace function grocery.set_item_nutrition(p_item uuid, p_food_cd text, p_food_name text, p_maker text, p_nutrition jsonb, p_chosen_by uuid)
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
                chosen_by = excluded.chosen_by, updated_at = excluded.updated_at
   where not coalesce((excluded.nutrition ->> 'auto')::boolean, false)
      or coalesce((grocery.item_nutrition.nutrition ->> 'auto')::boolean, false);
end;
$$;

create or replace function grocery.set_item_ingredients(
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
                chosen_by = excluded.chosen_by, updated_at = excluded.updated_at
   where not coalesce((excluded.details ->> 'auto')::boolean, false)
      or coalesce((grocery.item_ingredients.details ->> 'auto')::boolean, false);
end;
$$;
