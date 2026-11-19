-- 레시피 첫 판: recipe 스키마, 레시피·재료·단계, 링크 대기함과 일 받기, 처리기 상태, 보관 기록.
-- 출발점은 docs/recipes/contract/db-draft.sql. 등록 함수(import_recipe)는 20261122010000_recipe_import.sql,
-- 재료 사전·가진 재료·cookable은 20261122020000_recipe_pantry.sql에 있다.
--
-- 경계: recipe 스키마만 만들고 바꾼다. public.households, public.members, private.is_household_member는 참조만 하고,
-- grocery는 건드리지 않는다(tests/recipes/boundary.test.ts).
-- 낱말 목록(요리 종류·주재료·조리법·상황·난이도·계량 도구·출처)은 supabase/functions/_shared/recipeContract.ts와 같다.
-- 바꾸면 양쪽을 함께 바꾼다(tests/recipes/db.test.ts가 계약의 낱말을 하나씩 넣어 본다).

create schema if not exists recipe;
revoke all on schema recipe from public, anon;
grant usage on schema recipe to authenticated, service_role;

-- ───────────────────────── 레시피 ─────────────────────────
create table recipe.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- review: 확인이 필요한 곳이 있음, saved: 레시피북에 있음, archived: 보관(지우기 대신)
  status text not null default 'review' check (status in ('review', 'saved', 'archived')),
  title text not null check (char_length(title) between 1 and 80),
  summary text check (char_length(summary) <= 200),
  source_kind text not null check (source_kind in
    ('youtube', 'youtube_shorts', 'instagram', 'web', 'photo', 'text', 'manual')),
  -- 첫 판은 유튜브만(영상 id 11자). 인스타 따위는 뒤 마이그레이션이 꼴을 넓힌다.
  source_key text not null check (source_key ~ '^youtube:[A-Za-z0-9_-]{11}$'),
  source_url text,  -- 아래 check: source_key로 만든 정규 주소와 같아야 한다
  source_title text check (char_length(source_title) <= 200),
  channel text check (char_length(channel) <= 80),
  published_on date,
  duration_seconds int check (duration_seconds > 0),
  -- 출처 인분은 출처에 있을 때만, 출처와 함께. 덧붙인 인분(servings_suggested)은 출처 인분이 없을 때만 둔다.
  servings numeric(6, 2) check (servings > 0),
  servings_origin text check (servings_origin in
    ('description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'user')),
  servings_basis text check (char_length(servings_basis) <= 80),
  servings_suggested numeric(6, 2) check (servings_suggested > 0),
  cuisine text not null check (cuisine in ('한식', '양식', '일식', '중식', '기타')),
  mains text[] not null default '{}' check (cardinality(mains) <= 3 and mains <@ array[
    '돼지고기', '소고기', '닭고기', '기타 육류', '해산물', '달걀', '두부·콩', '채소', '버섯', '면', '밥·곡물',
    '빵·밀가루', '유제품', '기타']::text[]),
  main_details text[] not null default '{}' check (cardinality(main_details) <= 3),  -- 계약 tags.main_details
  methods text[] not null default '{}' check (cardinality(methods) <= 3 and methods <@ array[
    '볶음', '구이', '조림', '찜', '국·탕', '찌개·전골', '튀김', '무침', '부침·전', '비빔', '샐러드', '오븐', '끓이기',
    '기타']::text[]),
  occasions text[] not null default '{}' check (cardinality(occasions) <= 4 and occasions <@ array[
    '반찬', '한그릇', '국물', '술안주', '손님상', '도시락', '간식·디저트', '아침', '소스·양념']::text[]),
  difficulty text check (difficulty in ('쉬움', '보통', '어려움')),
  difficulty_basis jsonb check (jsonb_typeof(difficulty_basis) = 'object'),  -- { required, steps, heavy }
  measuring_tool text check (measuring_tool in ('계량스푼', '밥숟가락', '섞어 씀', '확인 못 함')),
  measuring_tool_basis jsonb not null default '[]'::jsonb check (jsonb_typeof(measuring_tool_basis) = 'array'),
  principles jsonb not null default '[]'::jsonb check (jsonb_typeof(principles) = 'array'),
  conflicts jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array'),
  glossary jsonb not null default '[]'::jsonb check (jsonb_typeof(glossary) = 'array'),
  corrections jsonb not null default '[]'::jsonb check (jsonb_typeof(corrections) = 'array'),
  review_items jsonb not null default '[]'::jsonb check (jsonb_typeof(review_items) = 'array'),
  review_count int not null default 0 check (review_count >= 0),  -- 트리거가 review_items를 센다
  extraction jsonb not null default '{}'::jsonb check (jsonb_typeof(extraction) = 'object'),
  memo text check (char_length(memo) <= 2000),          -- 우리 집 메모
  rating smallint check (rating between 1 and 5),
  favorite boolean not null default false,
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),        -- 트리거가 바꾼다(보관 사본을 다시 쓸지 정하는 기준)
  unique (household_id, source_key),
  unique (id, household_id),
  check (source_url = ('https://www.youtube.com/watch?v=' || substr(source_key, 9))
      or source_url = ('https://www.youtube.com/shorts/' || substr(source_key, 9))),
  check ((servings is null) = (servings_origin is null)),
  check (servings is null or servings_suggested is null),
  -- 담은 사람이 가계부에서 지워져도 레시피는 남는다
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)
);
create index recipes_household_status_idx on recipe.recipes (household_id, status, added_at desc);

-- 숫자의 출처: 설명란, 작성자 자막, 자동 자막, 받아쓰기, 화면 글자, 사람이 고침. editor(덧붙임)는 숫자가 없는 칸에만.
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
    ('description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'user', 'editor')),
  at_seconds int check (at_seconds >= 0),                -- 말·화면에서 가져온 숫자의 영상 시각
  suggested_amount numeric(10, 3) check (suggested_amount > 0),   -- 덧붙임
  suggested_unit text check (char_length(suggested_unit) <= 12),
  -- 재료 사전(recipe.ingredient_dict)의 id. 사전과 외래 키는 20261122020000_recipe_pantry.sql이 붙인다.
  ingredient_key text check (ingredient_key ~ '^[a-z0-9_]{1,60}$'),
  needs_review boolean not null default false,
  unique (recipe_id, position),
  -- 숫자 분량의 출처는 덧붙임일 수 없고, 숫자 분량이 있는 재료에는 덧붙인 분량을 두지 않는다
  check (amount is null or origin <> 'editor'),
  check (amount is null or (suggested_amount is null and suggested_unit is null)),
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
  cue_origin text check (cue_origin in
    ('description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'user', 'editor')),
  editor_tip text check (char_length(editor_tip) <= 200),   -- 덧붙임
  timer_seconds int check (timer_seconds > 0),
  video_start_seconds int check (video_start_seconds >= 0),
  uses jsonb not null default '[]'::jsonb check (jsonb_typeof(uses) = 'array'),
  origin text not null check (origin in
    ('description', 'caption_manual', 'caption_auto', 'asr', 'screen', 'user', 'editor')),
  needs_review boolean not null default false,
  unique (recipe_id, position),
  -- 시간도 출처 숫자다: 덧붙인 단계에는 타이머를 두지 않는다
  check (timer_seconds is null or origin <> 'editor'),
  foreign key (recipe_id, household_id) references recipe.recipes (id, household_id) on delete cascade
);

-- ───────────────────────── 링크 대기함 ─────────────────────────
-- 앱에서 주소를 담으면 한 줄(waiting). 맥 처리기가 서버 함수 recipe-worker(서비스 롤)로 claim_job을 불러 가져가고
-- (processing), 30초마다 job_progress로 단계와 진행 알림을 남긴다. 알림이 3분 끊기면 다시 내준다. 가져갈 때마다
-- attempts가 1 오르고, 세 번 가져간 줄은 더 내주지 않고 failed로 바꾼다. 사용량 제한으로 미룬 일(job_release)은 세지 않는다.
create table recipe.inbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- 처리기가 아무 곳에나 가게 하지 못하도록 주소는 source_key로 만든 정규 주소 두 꼴 중 하나와 같아야 한다(아래 check).
  -- 앱의 normalizeRecipeUrl(supabase/functions/_shared/recipeSource.ts)이 이 두 꼴을 만든다.
  url text not null,
  source_key text not null check (source_key ~ '^youtube:[A-Za-z0-9_-]{11}$'),
  state text not null default 'waiting' check (state in ('waiting', 'processing', 'done', 'failed')),
  -- 화면에 그대로 보이는 진행 글. 이 일곱 말만 쓴다(화면에 "AI"·"분석 중"을 쓰지 않는다).
  stage text check (stage in ('영상 정보 받는 중', '자막 받는 중', '말 받아쓰는 중', '화면 글자 읽는 중',
                              '레시피 정리 중', '다시 읽어 맞춰 보는 중', '저장 중')),
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  retry_at timestamptz,                                  -- 이 시각 전에는 내주지 않는다
  fail_reason text check (char_length(fail_reason) <= 200),
  recipe_id uuid,
  -- 구성원이 목록에서 치운 실패 일(지우지 않고 숨긴다). dismiss_job이 정하고 retry_job이 비운다.
  dismissed_at timestamptz,
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  check (dismissed_at is null or state = 'failed'),
  check (url = ('https://www.youtube.com/watch?v=' || substr(source_key, 9))
      or url = ('https://www.youtube.com/shorts/' || substr(source_key, 9))),
  foreign key (recipe_id, household_id) references recipe.recipes (id, household_id) on delete set null (recipe_id),
  foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)
);
-- 같은 가구에서 같은 출처의 대기·처리 중 줄은 하나만(두 사람이 거의 동시에 담아도)
create unique index inbox_open_source_idx on recipe.inbox (household_id, source_key)
  where state in ('waiting', 'processing');
create index inbox_household_added_idx on recipe.inbox (household_id, added_at desc);
create index inbox_claim_idx on recipe.inbox (state, added_at) where state in ('waiting', 'processing');

-- ───────────────────────── 처리기 상태 (한 줄) ─────────────────────────
-- 사본 상태(export_issue): 처리기가 사본(구글 드라이브·옵시디언)을 쓰지 못하면 정해진 까닭 하나, 괜찮으면 null.
-- 오류 글·경로·토큰은 담지 않는다. 말 목록은 supabase/functions/_shared/recipeWorkerStatus.ts의 EXPORT_ISSUES와 같다.
-- export_checked_at은 처리기가 사본을 마지막으로 써 보거나 시험한 시각(처음이면 null).
create table recipe.worker_status (
  id smallint primary key default 1 check (id = 1),
  last_seen_at timestamptz,
  version text check (char_length(version) <= 80),
  export_issue text check (export_issue in
    ('구글 드라이브 연결이 끊겼어요', '구글 드라이브에 쓰지 못했어요', '옵시디언 폴더에 쓰지 못했어요')),
  export_checked_at timestamptz
);
insert into recipe.worker_status (id) values (1);

-- ───────────────────────── 보관 기록 (구글 드라이브·옵시디언) ─────────────────────────
create table recipe.exports (
  recipe_id uuid primary key,
  household_id uuid not null,
  drive_doc_id text check (char_length(drive_doc_id) <= 200),
  drive_path text check (char_length(drive_path) <= 500),
  obsidian_path text check (char_length(obsidian_path) <= 500),
  exported_at timestamptz not null default now(),
  foreign key (recipe_id, household_id) references recipe.recipes (id, household_id) on delete cascade
);

-- ───────────────────────── 트리거 ─────────────────────────
-- review_count는 review_items의 수(앱에서 고쳐도 맞게). 고칠 때마다 updated_at = 지금(보낸 값은 무시).
create function recipe.recipes_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 배열이 아니면 check가 거절하게 둔다(여기서 jsonb_array_length가 먼저 터지지 않게)
  new.review_count := case when jsonb_typeof(new.review_items) = 'array' then jsonb_array_length(new.review_items) else 0 end;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function recipe.recipes_before_write() from public, anon, authenticated;

create trigger recipes_before_write
before insert or update on recipe.recipes
for each row execute function recipe.recipes_before_write();

-- 재료·단계를 넣고 고치고 지우면 그 레시피의 updated_at도 바꾼다. 앱 사용자의 칸별 권한과 상관없이 돌도록 definer.
create function recipe.touch_parent_recipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update recipe.recipes r set updated_at = now()
     where r.id = old.recipe_id and r.updated_at is distinct from now();
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.recipe_id is distinct from old.recipe_id) then
    update recipe.recipes r set updated_at = now()
     where r.id = new.recipe_id and r.updated_at is distinct from now();
  end if;
  return null;
end;
$$;
revoke execute on function recipe.touch_parent_recipe() from public, anon, authenticated;

create trigger ingredients_touch_recipe
after insert or update or delete on recipe.ingredients
for each row execute function recipe.touch_parent_recipe();
create trigger steps_touch_recipe
after insert or update or delete on recipe.steps
for each row execute function recipe.touch_parent_recipe();

-- ───────────────────────── 일 받기 (서비스 롤만) ─────────────────────────
-- 대기 줄 하나를 가져간다. 대상: retry_at이 지난 waiting, 진행 알림(없으면 가져간 시각)이 3분 넘게 끊긴 processing.
-- 둘 다 빈 processing 줄은 바로 다시 내준다. 가장 오래 담긴 것부터.
-- 처리기 둘이 동시에 불러도 같은 줄을 가져가지 않는다(for update skip locked). 시각은 부르는 쪽이 준다(p_now).
create function recipe.claim_job(p_now timestamptz)
returns setof recipe.inbox
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- 시각이 비면 heartbeat_at이 빈 processing 줄이 생겨 영영 다시 내주지 못한다
  if p_now is null then
    raise exception 'recipe_now_required' using errcode = '22004';
  end if;
  -- 세 번 가져간 줄은 더 내주지 않는다
  update recipe.inbox i
     set state = 'failed', stage = null,
         fail_reason = coalesce(i.fail_reason, '세 번 해 봤지만 끝내지 못했어요')
   where i.attempts >= 3
     and ((i.state = 'waiting' and (i.retry_at is null or i.retry_at <= p_now))
          or (i.state = 'processing'
              and coalesce(i.heartbeat_at, i.claimed_at, '-infinity'::timestamptz) < p_now - interval '3 minutes'));

  return query
  update recipe.inbox i
     set state = 'processing', stage = null, claimed_at = p_now, heartbeat_at = p_now,
         attempts = i.attempts + 1, retry_at = null
   where i.id = (
     select c.id
       from recipe.inbox c
      where c.attempts < 3
        and ((c.state = 'waiting' and (c.retry_at is null or c.retry_at <= p_now))
             or (c.state = 'processing'
                 and coalesce(c.heartbeat_at, c.claimed_at, '-infinity'::timestamptz) < p_now - interval '3 minutes'))
      order by c.added_at, c.id
      limit 1
      for update skip locked
   )
  returning i.*;
end;
$$;

-- 진행 단계와 진행 알림 시각. 처리 중인 줄이 아니면 false(가져간 일이 지워졌거나 끝났다).
create function recipe.job_progress(p_job uuid, p_stage text, p_now timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_now is null then
    raise exception 'recipe_now_required' using errcode = '22004';
  end if;
  update recipe.inbox i set stage = p_stage, heartbeat_at = p_now
   where i.id = p_job and i.state = 'processing';
  return found;
end;
$$;

-- 사용량 제한 따위로 미룬다: p_retry_at까지 기다리고, 이번 시도는 세지 않는다.
create function recipe.job_release(p_job uuid, p_retry_at timestamptz)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_retry_at is null then
    raise exception 'recipe_retry_at_required' using errcode = '22004';
  end if;
  update recipe.inbox i
     set state = 'waiting', stage = null, retry_at = p_retry_at, heartbeat_at = null,
         attempts = greatest(i.attempts - 1, 0)
   where i.id = p_job and i.state = 'processing';
  return found;
end;
$$;

-- 실패로 끝낸다(다시 하기는 구성원이 retry_job으로). 까닭은 화면에 보이는 글, 200자까지.
create function recipe.job_fail(p_job uuid, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update recipe.inbox i set state = 'failed', stage = null, fail_reason = left(p_reason, 200)
   where i.id = p_job and i.state = 'processing';
  return found;
end;
$$;

-- 다시 하기(앱의 구성원). 실패한 일, 또는 미뤄 둔 대기 일을 바로 다시 대기로 돌리고 시도 횟수를 비운다.
-- 앱 사용자에게 inbox의 update 권한을 주지 않으려고 함수로 둔다. 남의 가구 일이면 없는 일과 같은 오류.
-- 같은 출처의 대기 줄이 이미 있으면 유일 색인이 23505로 막는다(이미 담겨 있음).
create function recipe.retry_job(p_job uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select i.household_id into v_household from recipe.inbox i where i.id = p_job;
  if v_household is null or not (select private.is_household_member(v_household)) then
    raise exception 'recipe_job_not_found' using errcode = 'P0002';
  end if;
  update recipe.inbox i
     set state = 'waiting', attempts = 0, retry_at = null, fail_reason = null, stage = null,
         claimed_at = null, heartbeat_at = null, dismissed_at = null
   where i.id = p_job
     and (i.state = 'failed' or (i.state = 'waiting' and i.retry_at > now()));
  return found;
end;
$$;

-- 실패한 일을 목록에서 치운다(앱의 구성원). 지우지 않고 dismissed_at만 정한다. retry_job처럼 update 권한 대신 함수로 둔다.
-- 실패한 일이 아니거나 이미 치웠으면 false. 남의 가구 일이면 없는 일과 같은 오류.
create function recipe.dismiss_job(p_job uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select i.household_id into v_household from recipe.inbox i where i.id = p_job;
  if v_household is null or not (select private.is_household_member(v_household)) then
    raise exception 'recipe_job_not_found' using errcode = 'P0002';
  end if;
  update recipe.inbox i set dismissed_at = now()
   where i.id = p_job and i.state = 'failed' and i.dismissed_at is null;
  return found;
end;
$$;

-- ───────────────────────── 행 수준 보안 ─────────────────────────
alter table recipe.recipes enable row level security;
alter table recipe.ingredients enable row level security;
alter table recipe.steps enable row level security;
alter table recipe.inbox enable row level security;
alter table recipe.worker_status enable row level security;
alter table recipe.exports enable row level security;

-- 레시피: 넣기는 import_recipe(서비스 롤)로만, 지우기 대신 archived. 구성원은 읽고 정한 칸만 고친다.
create policy recipes_select on recipe.recipes for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy recipes_update on recipe.recipes for update to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));

create policy ingredients_all on recipe.ingredients for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));
create policy steps_all on recipe.steps for all to authenticated
  using ((select private.is_household_member(household_id)))
  with check ((select private.is_household_member(household_id)));

-- 대기함: 구성원은 읽고, 본인 이름으로 담고, 지운다. 상태는 처리기(서비스 롤)와 retry_job만 바꾼다.
create policy inbox_select on recipe.inbox for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy inbox_insert on recipe.inbox for insert to authenticated
  with check ((select private.is_household_member(household_id)) and added_by = (select auth.uid()));
create policy inbox_delete on recipe.inbox for delete to authenticated
  using ((select private.is_household_member(household_id)));

-- 처리기 상태는 가구와 무관한 한 줄. 어느 가구든 구성원이면 읽는다(가구가 없는 계정은 못 읽음).
create policy worker_status_select on recipe.worker_status for select to authenticated
  using (exists (select 1 from public.members m where m.user_id = (select auth.uid())));

create policy exports_select on recipe.exports for select to authenticated
  using ((select private.is_household_member(household_id)));

-- 로그인하지 않은 사용자(anon)는 아무 권한이 없다(스키마 사용 권한도 없다).
revoke all on recipe.recipes, recipe.ingredients, recipe.steps, recipe.inbox, recipe.worker_status, recipe.exports
  from public, anon, authenticated;
grant select on recipe.recipes to authenticated;
grant update (status, title, summary, servings, servings_origin, servings_basis, servings_suggested, cuisine,
              mains, main_details, methods, occasions, principles, conflicts, difficulty, difficulty_basis,
              measuring_tool, measuring_tool_basis, glossary, corrections, review_items, memo, rating, favorite,
              updated_at)
  on recipe.recipes to authenticated;  -- household_id, source_*, extraction, review_count, added_*는 바꿀 수 없다
grant select, insert, delete on recipe.ingredients, recipe.steps to authenticated;
grant update (position, section, name, amount, unit, amount_text, note, optional, origin, at_seconds,
              suggested_amount, suggested_unit, ingredient_key, needs_review)
  on recipe.ingredients to authenticated;  -- id, recipe_id, household_id는 바꿀 수 없다
grant update (position, title, body, heat, cue, cue_origin, editor_tip, timer_seconds, video_start_seconds, uses,
              origin, needs_review)
  on recipe.steps to authenticated;
grant select, delete on recipe.inbox to authenticated;
grant insert (household_id, url, source_key, added_by) on recipe.inbox to authenticated;  -- 상태·횟수는 정할 수 없다
grant select on recipe.worker_status, recipe.exports to authenticated;
grant select, insert, update, delete on recipe.recipes, recipe.ingredients, recipe.steps, recipe.inbox,
  recipe.exports to service_role;
grant select, insert, update on recipe.worker_status to service_role;

revoke execute on function recipe.claim_job(timestamptz) from public, anon, authenticated;
grant execute on function recipe.claim_job(timestamptz) to service_role;
revoke execute on function recipe.job_progress(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function recipe.job_progress(uuid, text, timestamptz) to service_role;
revoke execute on function recipe.job_release(uuid, timestamptz) from public, anon, authenticated;
grant execute on function recipe.job_release(uuid, timestamptz) to service_role;
revoke execute on function recipe.job_fail(uuid, text) from public, anon, authenticated;
grant execute on function recipe.job_fail(uuid, text) to service_role;
revoke execute on function recipe.retry_job(uuid) from public, anon;
grant execute on function recipe.retry_job(uuid) to authenticated;
revoke execute on function recipe.dismiss_job(uuid) from public, anon;
grant execute on function recipe.dismiss_job(uuid) to authenticated;

-- 실시간 동기화: publication이 있을 때만(장보기와 같은 방식)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table recipe.inbox, recipe.recipes, recipe.worker_status;
  end if;
end;
$$;
