-- 재료 사전, 가진 재료, 만들 수 있는 요리 cookable. 출발점은 docs/recipes/contract/db-draft.sql.
-- 바꾼 것:
--   - 사전(ingredient_dict)은 가구와 무관하다. 앱 사용자는 읽기만, 쓰기는 dict_add(서비스 롤)로만 한다.
--     dict_add는 새 id를 origin 'added'로 넣고, 이미 있는 id는 동의어만 합친다(이름·분류·상위 묶음·origin은 그대로).
--   - 가진 재료(pantry): 열 이름은 state(have 있음 / always 늘 있음), 출처 source는 manual·grocery·receipt.
--     구성원은 자기 가구 줄을 읽고 넣고(added_by = 본인) 고치고 지운다. 한 가구에 재료 하나는 한 줄.
--   - ingredients.ingredient_key가 사전을 가리키는 외래 키를 붙인다(사전 줄이 지워지면 null, id가 바뀌면 따라간다).
--     붙이기 전에 사전에 없는 키를 비운다(새 DB에는 없다).
--   - import_recipe는 사전에 없는 ingredient_key를 null로 저장한다(외래 키 위반으로 등록이 통째로 실패하지 않게).
--     그 밖의 동작은 20261122010000_recipe_import.sql과 같다.
--   - cookable은 security invoker라 부르는 사람의 권한(RLS)으로 돈다. 구성원이 아니면 0줄이고 오류가 아니다.
-- 경계: recipe 스키마만 만들고 바꾼다(tests/recipes/boundary.test.ts).

-- ───────────────────────── 재료 표준 사전 ─────────────────────────
-- 쿡앱(mise)의 사전 형식: 가독 슬러그 id, 표준명, 동의어, 요리 대분류 14종, 상위 묶음.
create table recipe.ingredient_dict (
  id text primary key check (id ~ '^[a-z0-9_]{1,60}$'),
  name text not null check (char_length(name) between 1 and 40),
  name_en text check (char_length(name_en) <= 60),
  aliases text[] not null default '{}',
  category text not null check (category in
    ('채소', '과일', '육류', '수산물', '곡물·전분', '콩·두류', '유제품·난류', '버섯', '견과·종실',
     '허브·향신료', '장·양념·소스', '유지', '음료', '가공·기타')),
  broader text,
  origin text not null default 'mise' check (origin in ('mise', 'added'))
);
create index ingredient_dict_aliases_idx on recipe.ingredient_dict using gin (aliases);

alter table recipe.ingredient_dict enable row level security;
create policy ingredient_dict_select on recipe.ingredient_dict for select to authenticated using (true);
revoke all on recipe.ingredient_dict from public, anon, authenticated;
grant select on recipe.ingredient_dict to authenticated;
grant select, insert, update, delete on recipe.ingredient_dict to service_role;

-- 재료의 사전 열쇠 → 사전. 사전에 없는 열쇠는 먼저 비운다.
update recipe.ingredients i set ingredient_key = null
 where i.ingredient_key is not null
   and not exists (select 1 from recipe.ingredient_dict d where d.id = i.ingredient_key);
alter table recipe.ingredients
  add constraint ingredients_ingredient_key_fkey
  foreign key (ingredient_key) references recipe.ingredient_dict (id) on update cascade on delete set null;

-- ───────────────────────── 가진 재료 ─────────────────────────
create table recipe.pantry (
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_key text not null references recipe.ingredient_dict (id) on update cascade on delete cascade,
  state text not null default 'have' check (state in ('have', 'always')),
  source text not null default 'manual' check (source in ('manual', 'grocery', 'receipt')),
  added_by uuid default auth.uid(),
  noted_at timestamptz not null default now(),
  primary key (household_id, ingredient_key),
  -- 담은 사람이 가계부에서 지워져도 줄은 남는다
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)
);

alter table recipe.pantry enable row level security;
create policy pantry_select on recipe.pantry for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy pantry_insert on recipe.pantry for insert to authenticated
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy pantry_update on recipe.pantry for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy pantry_delete on recipe.pantry for delete to authenticated
  using ((select private.is_household_member(household_id)));

revoke all on recipe.pantry from public, anon, authenticated;
grant select, delete on recipe.pantry to authenticated;
grant insert (household_id, ingredient_key, state, source, added_by, noted_at) on recipe.pantry to authenticated;
grant update (state, source, noted_at) on recipe.pantry to authenticated;  -- 가구·재료·담은 사람은 바꿀 수 없다
grant select, insert, update, delete on recipe.pantry to service_role;

-- ───────────────────────── dict_add ─────────────────────────
-- p_entries: [{id, name, aliases[], category, broader?}]. 새 id는 added로 넣고, 있는 id는 동의어만 합친다.
-- 돌려주는 값은 넣거나 바뀐 줄 수. 잘못된 입력은 22023으로 거절하고 아무것도 쓰지 않는다.
create function recipe.dict_add(p_entries jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_e jsonb;
  v_id text;
  v_aliases text[];
  v_old text[];
  v_new text[];
  v_n int := 0;
  v_cats constant text[] := array['채소', '과일', '육류', '수산물', '곡물·전분', '콩·두류', '유제품·난류', '버섯',
                                  '견과·종실', '허브·향신료', '장·양념·소스', '유지', '음료', '가공·기타'];
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'dict_entries_not_array' using errcode = '22023';
  end if;

  -- 먼저 모두 검사한다(쓰기 전에 거절)
  for v_e in select e from jsonb_array_elements(p_entries) as t(e) loop
    if jsonb_typeof(v_e) is distinct from 'object'
       or jsonb_typeof(v_e -> 'id') is distinct from 'string'
       or (v_e ->> 'id') !~ '^[a-z0-9_]{1,60}$' then
      raise exception 'dict_bad_id' using errcode = '22023';
    end if;
    if jsonb_typeof(v_e -> 'name') is distinct from 'string'
       or char_length(v_e ->> 'name') not between 1 and 40 then
      raise exception 'dict_bad_name:%', v_e ->> 'id' using errcode = '22023';
    end if;
    if jsonb_typeof(v_e -> 'category') is distinct from 'string'
       or not ((v_e ->> 'category') = any (v_cats)) then
      raise exception 'dict_bad_category:%', v_e ->> 'id' using errcode = '22023';
    end if;
    if jsonb_typeof(v_e -> 'aliases') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(v_e -> 'aliases') a where jsonb_typeof(a) <> 'string') then
      raise exception 'dict_bad_aliases:%', v_e ->> 'id' using errcode = '22023';
    end if;
    if v_e ? 'broader' and jsonb_typeof(v_e -> 'broader') not in ('string', 'null') then
      raise exception 'dict_bad_broader:%', v_e ->> 'id' using errcode = '22023';
    end if;
  end loop;

  for v_e in select e from jsonb_array_elements(p_entries) as t(e) loop
    v_id := v_e ->> 'id';
    select coalesce(array_agg(x order by o), '{}'::text[]) into v_aliases
      from (select a as x, min(n) as o
              from jsonb_array_elements_text(v_e -> 'aliases') with ordinality as t(a, n)
             group by a) s;
    select d.aliases into v_old from recipe.ingredient_dict d where d.id = v_id for update;
    if not found then
      insert into recipe.ingredient_dict (id, name, aliases, category, broader, origin)
      values (v_id, v_e ->> 'name', v_aliases, v_e ->> 'category', nullif(v_e ->> 'broader', ''), 'added');
      v_n := v_n + 1;
    else
      select v_old || coalesce(array_agg(a order by o), '{}'::text[]) into v_new
        from (select a, min(n) as o
                from unnest(v_aliases) with ordinality as t(a, n)
               where not (a = any (v_old))
               group by a) s;
      if cardinality(v_new) > cardinality(v_old) then
        update recipe.ingredient_dict d set aliases = v_new where d.id = v_id;
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  return v_n;
end;
$$;
revoke execute on function recipe.dict_add(jsonb) from public, anon, authenticated;
grant execute on function recipe.dict_add(jsonb) to service_role;

-- ───────────────────────── cookable ─────────────────────────
-- 가구 하나의 saved 레시피 중, 필수 재료(optional 아님, 사전 열쇠 있음)가 모자란 수 ≤ p_max_missing인 것.
-- 가진 것: 그 열쇠가 pantry에 state have 또는 always로 있는 것. 모자란 수 적은 순, 가진 수 많은 순.
-- 같은 열쇠가 두 번 나와도(양념장과 소스의 간장) 한 번만 센다. 앱의 pantrySummary·missingIngredients와 같은 셈이고,
-- 모자란 재료 이름은 열쇠마다 처음 나온 줄의 이름 하나다.
-- security invoker라 RLS가 구성원만 통과시킨다(구성원이 아니면 0줄). 세지 않는 재료만 있는 레시피는 나오지 않는다.
create function recipe.cookable(p_household uuid, p_max_missing int default 2)
returns table (recipe_id uuid, have int, need int, missing text[])
language sql
stable
security invoker
set search_path = ''
as $$
  with need as (
    select r.id as recipe_id, r.added_at, i.ingredient_key,
           min(i.position) as pos, (array_agg(i.name order by i.position))[1] as name
      from recipe.recipes r
      join recipe.ingredients i
        on i.recipe_id = r.id and not i.optional and i.ingredient_key is not null
     where r.household_id = p_household and r.status = 'saved'
     group by r.id, r.added_at, i.ingredient_key
  )
  select n.recipe_id,
         count(distinct p.ingredient_key)::int as have,
         count(distinct n.ingredient_key)::int as need,
         coalesce(array_agg(n.name order by n.pos) filter (where p.ingredient_key is null), '{}'::text[]) as missing
    from need n
    left join recipe.pantry p
      on p.household_id = p_household and p.ingredient_key = n.ingredient_key and p.state in ('have', 'always')
   group by n.recipe_id, n.added_at
  having count(distinct n.ingredient_key) - count(distinct p.ingredient_key) <= p_max_missing
   order by count(distinct n.ingredient_key) - count(distinct p.ingredient_key), count(distinct p.ingredient_key) desc,
            n.added_at desc, n.recipe_id;
$$;
revoke execute on function recipe.cookable(uuid, int) from public, anon;
grant execute on function recipe.cookable(uuid, int) to authenticated, service_role;

-- ───────────────────────── import_recipe: 사전에 없는 열쇠는 null ─────────────────────────
create or replace function recipe.import_recipe(
  p_job uuid,
  p_recipe jsonb,
  p_difficulty text,
  p_difficulty_basis jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job recipe.inbox%rowtype;
  v_key text := p_recipe #>> '{source,key}';
  v_review jsonb := coalesce(nullif(p_recipe -> 'review_items', 'null'::jsonb), '[]'::jsonb);
  v_id uuid;
begin
  -- 일: 처리 중인 줄만. 다른 처리기·구성원의 삭제와 겹치지 않게 잠근다.
  select * into v_job from recipe.inbox i where i.id = p_job for update;
  if not found then
    raise exception 'recipe_job_not_found' using errcode = 'P0002';
  end if;
  if v_job.state <> 'processing' then
    raise exception 'recipe_job_not_processing:%', v_job.state using errcode = '55000';
  end if;

  -- 계약 모양(자세한 검사는 recipe-worker의 parseRecipe가 먼저 한다)
  if p_recipe ->> 'contract_version' is distinct from '2' then
    raise exception 'recipe_contract_version' using errcode = '22023';
  end if;
  if jsonb_typeof(p_recipe -> 'ingredients') is distinct from 'array'
     or jsonb_typeof(p_recipe -> 'steps') is distinct from 'array'
     or jsonb_array_length(p_recipe -> 'ingredients') = 0
     or jsonb_array_length(p_recipe -> 'steps') = 0 then
    raise exception 'recipe_missing_ingredients_or_steps' using errcode = '22023';
  end if;
  if v_key is not null and v_key <> v_job.source_key then
    raise exception 'recipe_source_mismatch' using errcode = '22023';
  end if;

  insert into recipe.recipes as r (
    household_id, status, title, summary, source_kind, source_key, source_url, source_title, channel,
    published_on, duration_seconds, servings, servings_origin, servings_basis, servings_suggested,
    cuisine, mains, main_details, methods, occasions, difficulty, difficulty_basis,
    measuring_tool, measuring_tool_basis, principles, conflicts, glossary, corrections, review_items,
    extraction, added_by
  ) values (
    v_job.household_id,
    case when jsonb_typeof(v_review) = 'array' and jsonb_array_length(v_review) = 0 then 'saved' else 'review' end,
    p_recipe ->> 'title',
    p_recipe ->> 'summary',
    case when v_job.url like 'https://www.youtube.com/shorts/%' then 'youtube_shorts' else 'youtube' end,
    v_job.source_key,
    v_job.url,
    p_recipe #>> '{source,title}',
    p_recipe #>> '{source,channel}',
    (p_recipe #>> '{source,published_on}')::date,
    (p_recipe #>> '{source,duration_seconds}')::int,
    (p_recipe #>> '{servings,value}')::numeric,
    p_recipe #>> '{servings,origin}',
    p_recipe #>> '{servings,basis}',
    (p_recipe #>> '{servings,suggested}')::numeric,
    p_recipe #>> '{tags,cuisine}',
    recipe.json_text_array(p_recipe #> '{tags,mains}'),
    recipe.json_text_array(p_recipe #> '{tags,main_details}'),
    recipe.json_text_array(p_recipe #> '{tags,methods}'),
    recipe.json_text_array(p_recipe #> '{tags,occasions}'),
    p_difficulty,
    nullif(p_difficulty_basis, 'null'::jsonb),
    p_recipe ->> 'measuring_tool',
    coalesce(nullif(p_recipe -> 'measuring_tool_basis', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_recipe -> 'principles', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_recipe -> 'conflicts', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_recipe -> 'glossary', 'null'::jsonb), '[]'::jsonb),
    coalesce(nullif(p_recipe -> 'corrections', 'null'::jsonb), '[]'::jsonb),
    v_review,
    coalesce(nullif(p_recipe -> 'extraction', 'null'::jsonb), '{}'::jsonb),
    v_job.added_by  -- 비어 있어도 그대로(기본값 auth.uid()를 쓰지 않는다)
  )
  -- 같은 가구·같은 출처의 보관한 레시피: 같은 id에 바꾼다. memo, rating, favorite은 남긴다.
  on conflict (household_id, source_key) do update set
    status = excluded.status,
    title = excluded.title,
    summary = excluded.summary,
    source_kind = excluded.source_kind,
    source_url = excluded.source_url,
    source_title = excluded.source_title,
    channel = excluded.channel,
    published_on = excluded.published_on,
    duration_seconds = excluded.duration_seconds,
    servings = excluded.servings,
    servings_origin = excluded.servings_origin,
    servings_basis = excluded.servings_basis,
    servings_suggested = excluded.servings_suggested,
    cuisine = excluded.cuisine,
    mains = excluded.mains,
    main_details = excluded.main_details,
    methods = excluded.methods,
    occasions = excluded.occasions,
    difficulty = excluded.difficulty,
    difficulty_basis = excluded.difficulty_basis,
    measuring_tool = excluded.measuring_tool,
    measuring_tool_basis = excluded.measuring_tool_basis,
    principles = excluded.principles,
    conflicts = excluded.conflicts,
    glossary = excluded.glossary,
    corrections = excluded.corrections,
    review_items = excluded.review_items,
    extraction = excluded.extraction,
    -- 보관했던 레시피를 다시 담으면 새로 담은 것으로(목록에서 새것으로 보인다)
    added_by = excluded.added_by,
    added_at = now()
  -- 바꾸는 것은 보관(archived)한 레시피뿐이다. 레시피북에 있는(review·saved) 레시피는 사람이 고친 값이 있으니 덮지 않는다.
  where r.status = 'archived'
  returning r.id into v_id;

  -- 같은 출처의 레시피가 레시피북에 있다(옛 실패 일을 다시 한 경우 따위). 처리기는 이 번호를 "이미 레시피북에 있어요"로 바꾼다.
  -- 번호 RCP01은 supabase/functions/_shared/recipeWorkerStatus.ts의 RECIPE_EXISTS_CODE와 같다.
  if v_id is null then
    raise exception 'recipe_exists' using errcode = 'RCP01';
  end if;

  -- 재료·단계는 통째로 바꾼다(자리 번호가 겹치지 않게 먼저 지운다)
  delete from recipe.ingredients i where i.recipe_id = v_id;
  delete from recipe.steps s where s.recipe_id = v_id;

  insert into recipe.ingredients (
    recipe_id, household_id, position, section, name, amount, unit, amount_text, note, optional, origin,
    at_seconds, suggested_amount, suggested_unit, ingredient_key, needs_review
  )
  select v_id, v_job.household_id, t.pos::int,
         t.e ->> 'section', t.e ->> 'name', (t.e ->> 'amount')::numeric, t.e ->> 'unit', t.e ->> 'amount_text',
         t.e ->> 'note', coalesce((t.e ->> 'optional')::boolean, false), t.e ->> 'origin',
         (t.e ->> 'at_seconds')::int, (t.e ->> 'suggested_amount')::numeric, t.e ->> 'suggested_unit',
         (select d.id from recipe.ingredient_dict d where d.id = t.e ->> 'ingredient_key'),  -- 사전에 없으면 비운다
         coalesce((t.e ->> 'needs_review')::boolean, false)
    from jsonb_array_elements(p_recipe -> 'ingredients') with ordinality as t(e, pos);

  insert into recipe.steps (
    recipe_id, household_id, position, title, body, heat, cue, cue_origin, editor_tip, timer_seconds,
    video_start_seconds, uses, origin, needs_review
  )
  select v_id, v_job.household_id, t.pos::int,
         t.e ->> 'title', t.e ->> 'body', t.e ->> 'heat', t.e ->> 'cue', t.e ->> 'cue_origin', t.e ->> 'editor_tip',
         (t.e ->> 'timer_seconds')::int, (t.e ->> 'video_start_seconds')::int,
         coalesce(nullif(t.e -> 'uses', 'null'::jsonb), '[]'::jsonb), t.e ->> 'origin',
         coalesce((t.e ->> 'needs_review')::boolean, false)
    from jsonb_array_elements(p_recipe -> 'steps') with ordinality as t(e, pos);

  update recipe.inbox i set state = 'done', stage = null, recipe_id = v_id where i.id = p_job;

  return v_id;
end;
$$;

revoke execute on function recipe.import_recipe(uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function recipe.import_recipe(uuid, jsonb, text, jsonb) to service_role;

-- ───────────────────────── 실시간 동기화 ─────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table recipe.pantry;
  end if;
end;
$$;
