-- 레시피 DB 초안 (적용 전). 단계 R1에서 supabase/migrations/<가장 늦은 파일 뒤 시각>_recipe_init.sql로 옮기고
-- tests/recipes/*.test.ts(PGlite)로 검증한 뒤, 사용자 확인을 받아 Supabase MCP apply_migration으로만 적용한다.
-- 이 초안은 2026-11-18에 PGlite(가계부 공유 스키마 사본 위)에서 한 번 돌려 봤다. 결과는 docs/recipes/tracking/status.md.
--
-- 경계: recipe 스키마만 만들고 바꾼다. public.households, public.members, private.is_household_member는 참조만 한다.

create schema if not exists recipe;
revoke all on schema recipe from public, anon;
grant usage on schema recipe to authenticated, service_role;

-- ───────────────────────── 재료 표준 사전 (가구와 무관, 앱에서는 읽기만) ─────────────────────────
-- 쿡앱(mise)의 사전 형식을 그대로 받는다: 가독 슬러그 id, 표준명, 동의어, 요리 대분류 14종, 상위 묶음.
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

-- ───────────────────────── 레시피 ─────────────────────────
create table recipe.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- draft: 검토 대기, saved: 레시피북에 있음, archived: 보관
  status text not null default 'draft' check (status in ('draft', 'saved', 'archived')),
  title text not null check (char_length(title) between 1 and 80),
  summary text check (char_length(summary) <= 200),
  source_kind text not null check (source_kind in
    ('youtube', 'youtube_shorts', 'instagram', 'web', 'photo', 'text', 'manual')),
  source_key text not null check (char_length(source_key) between 3 and 200),
  source_url text check (source_url ~ '^https://'),
  source_title text check (char_length(source_title) <= 200),
  channel text check (char_length(channel) <= 80),
  published_on date,
  duration_seconds int check (duration_seconds > 0),
  servings numeric(6, 2) check (servings > 0),          -- 출처에 있을 때만
  servings_origin text,
  servings_basis text check (char_length(servings_basis) <= 80),
  servings_suggested numeric(6, 2) check (servings_suggested > 0),  -- 덧붙임
  cuisine text,
  mains text[] not null default '{}',
  methods text[] not null default '{}',
  occasions text[] not null default '{}',
  principles jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  extraction jsonb not null default '{}'::jsonb,
  review_count int not null default 0 check (review_count >= 0),  -- 확인이 필요한 곳 수
  memo text check (char_length(memo) <= 2000),          -- 우리 집 메모
  rating smallint check (rating between 1 and 5),
  favorite boolean not null default false,
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, source_key),
  unique (id, household_id),
  check (servings is null or servings_origin is not null),
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)
);
create index recipes_household_status_idx on recipe.recipes (household_id, status, added_at desc);

create table recipe.ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  household_id uuid not null,
  position int not null check (position between 1 and 200),
  section text check (char_length(section) <= 20),
  name text not null check (char_length(name) between 1 and 60),
  amount numeric(10, 3) check (amount > 0),              -- 출처에 있는 숫자만
  unit text check (char_length(unit) <= 12),
  amount_text text check (char_length(amount_text) <= 20),
  note text check (char_length(note) <= 160),
  optional boolean not null default false,
  origin text not null check (origin in
    ('description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'page', 'secondary', 'user', 'editor')),
  suggested_amount numeric(10, 3) check (suggested_amount > 0),   -- 덧붙임
  suggested_unit text check (char_length(suggested_unit) <= 12),
  ingredient_key text references recipe.ingredient_dict (id) on update cascade on delete set null,
  needs_review boolean not null default false,
  unique (recipe_id, position),
  -- 숫자 분량의 출처는 2차 자료나 덧붙임일 수 없다
  check (amount is null or origin not in ('secondary', 'editor')),
  foreign key (recipe_id, household_id) references recipe.recipes (id, household_id) on delete cascade
);
create index ingredients_key_idx on recipe.ingredients (household_id, ingredient_key);

create table recipe.steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  household_id uuid not null,
  position int not null check (position between 1 and 60),
  title text not null check (char_length(title) between 1 and 30),
  body text not null check (char_length(body) between 1 and 400),
  heat text check (char_length(heat) <= 30),
  cue text check (char_length(cue) <= 200),
  cue_origin text,
  editor_tip text check (char_length(editor_tip) <= 200),
  timer_seconds int check (timer_seconds > 0),
  video_start_seconds int check (video_start_seconds >= 0),
  uses jsonb not null default '[]'::jsonb,
  origin text not null check (origin in
    ('description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'page', 'secondary', 'user', 'editor')),
  needs_review boolean not null default false,
  unique (recipe_id, position),
  foreign key (recipe_id, household_id) references recipe.recipes (id, household_id) on delete cascade
);

-- ───────────────────────── 가진 재료 ─────────────────────────
-- have: 지금 있음. always: 소금·설탕·간장처럼 늘 있는 것(한 번만 정해 두면 계속 '있음'으로 센다)
create table recipe.pantry (
  household_id uuid not null references public.households (id) on delete cascade,
  ingredient_key text not null references recipe.ingredient_dict (id) on update cascade on delete cascade,
  kind text not null default 'have' check (kind in ('have', 'always')),
  source text not null default 'manual' check (source in ('manual', 'grocery', 'receipt')),
  noted_at timestamptz not null default now(),
  primary key (household_id, ingredient_key)
);

-- ───────────────────────── 링크 대기함 ─────────────────────────
-- 앱이나 휴대폰에서 주소만 담아 두면, Claude Code나 claude.ai가 나중에 읽어 초안으로 만든다.
create table recipe.inbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  note text check (char_length(note) <= 200),
  state text not null default 'waiting' check (state in ('waiting', 'done', 'needs_more', 'failed')),
  recipe_id uuid references recipe.recipes (id) on delete set null,
  fail_reason text check (char_length(fail_reason) <= 200),
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  handled_at timestamptz,
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)
);
create index inbox_household_state_idx on recipe.inbox (household_id, state, added_at);

-- ───────────────────────── 행 수준 보안 ─────────────────────────
alter table recipe.recipes enable row level security;
alter table recipe.ingredients enable row level security;
alter table recipe.steps enable row level security;
alter table recipe.pantry enable row level security;
alter table recipe.inbox enable row level security;

create policy recipes_select on recipe.recipes for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy recipes_insert on recipe.recipes for insert to authenticated
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy recipes_update on recipe.recipes for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy recipes_delete on recipe.recipes for delete to authenticated
  using ((select private.is_household_member(household_id)));

create policy ingredients_all on recipe.ingredients for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy steps_all on recipe.steps for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy pantry_all on recipe.pantry for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));

create policy inbox_select on recipe.inbox for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy inbox_insert on recipe.inbox for insert to authenticated
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy inbox_update on recipe.inbox for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy inbox_delete on recipe.inbox for delete to authenticated
  using ((select private.is_household_member(household_id)));

revoke all on recipe.recipes, recipe.ingredients, recipe.steps, recipe.pantry, recipe.inbox
  from public, anon, authenticated;
grant select, insert, delete on recipe.recipes to authenticated;
grant update (status, title, summary, servings, servings_origin, servings_basis, servings_suggested,
              cuisine, mains, methods, occasions, principles, conflicts, review_count,
              memo, rating, favorite, updated_at)
  on recipe.recipes to authenticated;          -- household_id, source_*, extraction, added_by, added_at은 바꿀 수 없다
grant select, insert, update, delete on recipe.ingredients, recipe.steps, recipe.pantry to authenticated;
grant select, insert, delete on recipe.inbox to authenticated;
grant update (note, state, recipe_id, fail_reason, handled_at) on recipe.inbox to authenticated;
grant select, insert, update, delete on recipe.recipes, recipe.ingredients, recipe.steps, recipe.pantry, recipe.inbox
  to service_role;

-- ───────────────────────── 등록: 이 함수 하나로만 ─────────────────────────
-- 계약(docs/recipes/contract/recipe.schema.json)을 따르는 JSON 한 건을 초안(draft)으로 넣는다.
-- 앱(로그인한 사용자)에서 부르면 본인·본인 가구만 되고, Supabase MCP(로그인 없음)에서 부르면
-- p_added_by가 그 가구의 구성원인지 직접 확인한다.
-- 같은 출처가 이미 있으면 p_replace가 참일 때만 덮어쓴다(우리 집 메모·별점·즐겨찾기는 남긴다).
create or replace function recipe.import_recipe(
  p_household uuid,
  p_added_by uuid,
  p_recipe jsonb,
  p_replace boolean default false
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := p_recipe #>> '{source,key}';
  v_id uuid;
  v_review int;
begin
  if p_recipe ->> 'contract_version' is distinct from '1' then
    raise exception 'recipe_contract_version' using errcode = '22023';
  end if;
  if v_key is null or p_recipe ->> 'title' is null then
    raise exception 'recipe_missing_source_or_title' using errcode = '22023';
  end if;
  if jsonb_typeof(p_recipe -> 'ingredients') is distinct from 'array'
     or jsonb_typeof(p_recipe -> 'steps') is distinct from 'array' then
    raise exception 'recipe_missing_ingredients_or_steps' using errcode = '22023';
  end if;

  if v_uid is not null then
    if p_added_by is distinct from v_uid or not (select private.is_household_member(p_household)) then
      raise exception 'recipe_not_member' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_added_by) then
    raise exception 'recipe_not_member' using errcode = '42501';
  end if;

  select r.id into v_id from recipe.recipes r where r.household_id = p_household and r.source_key = v_key;

  if v_id is not null and not p_replace then
    raise exception 'recipe_exists:%', v_id using errcode = '23505';
  end if;

  if v_id is not null then
    delete from recipe.ingredients i where i.recipe_id = v_id;
    delete from recipe.steps s where s.recipe_id = v_id;
    update recipe.recipes r set
      status = 'draft',
      title = p_recipe ->> 'title',
      summary = p_recipe ->> 'summary',
      servings = (p_recipe #>> '{servings,value}')::numeric,
      servings_origin = p_recipe #>> '{servings,origin}',
      servings_basis = p_recipe #>> '{servings,basis}',
      servings_suggested = (p_recipe #>> '{servings,suggested}')::numeric,
      cuisine = p_recipe #>> '{tags,cuisine}',
      mains = array(select jsonb_array_elements_text(coalesce(p_recipe #> '{tags,mains}', '[]'::jsonb))),
      methods = array(select jsonb_array_elements_text(coalesce(p_recipe #> '{tags,methods}', '[]'::jsonb))),
      occasions = array(select jsonb_array_elements_text(coalesce(p_recipe #> '{tags,occasions}', '[]'::jsonb))),
      principles = coalesce(p_recipe -> 'principles', '[]'::jsonb),
      conflicts = coalesce(p_recipe -> 'conflicts', '[]'::jsonb),
      updated_at = now()
    where r.id = v_id;
    -- extraction은 앱 사용자가 바꿀 수 없는 칸이라, 다시 읽은 기록은 등록 권한이 있는 쪽(MCP)에서만 갱신된다
    if v_uid is null then
      update recipe.recipes r set extraction = coalesce(p_recipe -> 'extraction', '{}'::jsonb) where r.id = v_id;
    end if;
  else
    insert into recipe.recipes (
      household_id, status, title, summary, source_kind, source_key, source_url, source_title, channel,
      published_on, duration_seconds, servings, servings_origin, servings_basis, servings_suggested,
      cuisine, mains, methods, occasions, principles, conflicts, extraction, added_by
    ) values (
      p_household, 'draft', p_recipe ->> 'title', p_recipe ->> 'summary',
      p_recipe #>> '{source,kind}', v_key, p_recipe #>> '{source,url}', p_recipe #>> '{source,title}',
      p_recipe #>> '{source,channel}', (p_recipe #>> '{source,published_on}')::date,
      (p_recipe #>> '{source,duration_seconds}')::int,
      (p_recipe #>> '{servings,value}')::numeric, p_recipe #>> '{servings,origin}',
      p_recipe #>> '{servings,basis}', (p_recipe #>> '{servings,suggested}')::numeric,
      p_recipe #>> '{tags,cuisine}',
      array(select jsonb_array_elements_text(coalesce(p_recipe #> '{tags,mains}', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(p_recipe #> '{tags,methods}', '[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(p_recipe #> '{tags,occasions}', '[]'::jsonb))),
      coalesce(p_recipe -> 'principles', '[]'::jsonb), coalesce(p_recipe -> 'conflicts', '[]'::jsonb),
      coalesce(p_recipe -> 'extraction', '{}'::jsonb), p_added_by
    ) returning id into v_id;
  end if;

  insert into recipe.ingredients (
    recipe_id, household_id, position, section, name, amount, unit, amount_text, note, optional, origin,
    suggested_amount, suggested_unit, ingredient_key, needs_review
  )
  select v_id, p_household, t.pos::int, t.e ->> 'section', t.e ->> 'name', (t.e ->> 'amount')::numeric,
         t.e ->> 'unit', t.e ->> 'amount_text', t.e ->> 'note', coalesce((t.e ->> 'optional')::boolean, false),
         t.e ->> 'origin', (t.e ->> 'suggested_amount')::numeric, t.e ->> 'suggested_unit',
         (select d.id from recipe.ingredient_dict d where d.id = t.e ->> 'ingredient_key'),  -- 사전에 없으면 비운다
         coalesce((t.e ->> 'needs_review')::boolean, false)
  from jsonb_array_elements(p_recipe -> 'ingredients') with ordinality as t(e, pos);

  insert into recipe.steps (
    recipe_id, household_id, position, title, body, heat, cue, cue_origin, editor_tip, timer_seconds,
    video_start_seconds, uses, origin, needs_review
  )
  select v_id, p_household, t.pos::int, t.e ->> 'title', t.e ->> 'body', t.e ->> 'heat', t.e ->> 'cue',
         t.e ->> 'cue_origin', t.e ->> 'editor_tip', (t.e ->> 'timer_seconds')::int,
         (t.e ->> 'video_start_seconds')::int, coalesce(t.e -> 'uses', '[]'::jsonb), t.e ->> 'origin',
         coalesce((t.e ->> 'needs_review')::boolean, false)
  from jsonb_array_elements(p_recipe -> 'steps') with ordinality as t(e, pos);

  select (select count(*) from recipe.ingredients i where i.recipe_id = v_id and i.needs_review)
       + (select count(*) from recipe.steps s where s.recipe_id = v_id and s.needs_review)
       + (select count(*) from jsonb_array_elements(coalesce(p_recipe -> 'principles', '[]'::jsonb)) x
          where coalesce((x ->> 'needs_review')::boolean, false))
       + jsonb_array_length(coalesce(p_recipe -> 'conflicts', '[]'::jsonb))
    into v_review;
  update recipe.recipes r set review_count = v_review where r.id = v_id;

  return v_id;
end;
$$;
revoke execute on function recipe.import_recipe(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function recipe.import_recipe(uuid, uuid, jsonb, boolean) to authenticated, service_role;

-- ───────────────────────── 가진 재료로 만들 수 있는 요리 ─────────────────────────
-- 쿡앱의 겹침 순위(있는 것 많은 순, 모자란 것 적은 순)를 SQL로 옮긴 것. 사전에 맞추지 못한 재료는 '모자람'으로 센다.
-- 선택 재료(optional)는 세지 않는다. 부르는 사람의 권한으로 돌아서 자기 가구 레시피만 나온다.
create or replace function recipe.cookable(p_household uuid, p_max_missing int default 3)
returns table (recipe_id uuid, title text, need int, have int, missing text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.title,
         count(*)::int as need,
         count(p.ingredient_key)::int as have,
         coalesce(array_agg(i.name order by i.position) filter (where p.ingredient_key is null), '{}') as missing
  from recipe.recipes r
  join recipe.ingredients i on i.recipe_id = r.id and not i.optional
  left join recipe.pantry p on p.household_id = r.household_id and p.ingredient_key = i.ingredient_key
  where r.household_id = p_household and r.status = 'saved'
  group by r.id, r.title
  having count(*) - count(p.ingredient_key) <= p_max_missing
  order by count(*) - count(p.ingredient_key), count(p.ingredient_key) desc, r.title;
$$;
revoke execute on function recipe.cookable(uuid, int) from public, anon;
grant execute on function recipe.cookable(uuid, int) to authenticated, service_role;
