-- 레시피 등록 함수 import_recipe(최종본). 처리기가 정리한 계약 v2 JSON 한 건을 대기 줄(p_job)의 가구에 넣는다.
-- 이 파일을 따로 둔 까닭: 함수 본문에 delete 문장(다시 담는 보관 레시피의 재료·단계를 지우고 새로 넣기)이 있다.
-- Supabase MCP의 apply_migration은 delete 문장이 든 SQL을 "Invalid or expired requestState"로 거절하므로
-- 이 파일만 SQL 편집기에서 직접 적용하고(적용 뒤 pg_proc에 recipe.import_recipe가 있는지 확인), 나머지 파일은 MCP로 적용한다.
-- 앞선 레시피 파일(20261122000000_recipe_init, 20261122010000_recipe_import, 20261122020000_recipe_pantry)의
-- 표(recipes, ingredients, steps, inbox)와 재료 사전(ingredient_dict), 함수 json_text_array가 먼저 있어야 한다.
-- 같은 가구·출처가 보관(archived)이면 같은 id에 내용을 바꾸고, review·saved이면 덮지 않고 RCP01('recipe_exists')로 거절한다.
-- 사전에 없는 ingredient_key는 null로 저장한다(외래 키 위반으로 등록이 통째로 실패하지 않게).
--
-- 경계: recipe 스키마만 만들고 바꾼다(tests/recipes/boundary.test.ts).

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
