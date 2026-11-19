// 경계: 레시피 마이그레이션(_recipe_)은 recipe 스키마만 만들고 바꾼다. public은 참조·읽기만, grocery는 건드리지 않는다.
// 장보기 경계 검사(tests/grocery/boundary.test.ts)의 PUBLIC_WRITES 정규식에 grocery를 더하고,
// 스키마를 빠뜨리거나 다른 스키마에 만드는 것도 잡는다. 그 파일은 시험 파일이라 가져오지 않고 규칙을 옮겨 적는다
// (가져오면 그 파일의 describe가 여기서 한 번 더 돈다).
import { describe, expect, it } from 'vitest'
import { MIGRATION_FILES, isGrocery, readMigration } from '../grocery/dbSetup'

const isRecipe = (f: string) => f.includes('_recipe_')

// 주석을 지우되 줄 수는 그대로 둔다(실패 메시지의 줄 번호를 맞추려고)
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, '')

const OTHER = String.raw`(public|grocery)`
const OBJECTS = String.raw`(table|view|materialized\s+view|function|procedure|type|domain|sequence|index|trigger|policy|schema)`

const RULES: ReadonlyArray<[string, RegExp]> = [
  ['public·grocery 객체 만들기·바꾸기·지우기',
    new RegExp(String.raw`\b(create|alter|drop)\s+(or\s+replace\s+)?(unique\s+)?${OBJECTS}\s+(if\s+(not\s+)?exists\s+)?(only\s+)?${OTHER}\.`, 'gi')],
  ['public·grocery 표에 인덱스·트리거·정책 걸기',
    new RegExp(String.raw`\b(create|drop)\s+(unique\s+)?(index|trigger|policy)\b[^;]*?\bon\s+(only\s+)?${OTHER}\.`, 'gi')],
  ['public·grocery 권한 바꾸기',
    new RegExp(String.raw`\b(grant|revoke)\b[^;]*?\bon\s+(table\s+|function\s+|sequence\s+|schema\s+|all\s+(tables|functions|sequences)\s+in\s+schema\s+)?${OTHER}\b`, 'gi')],
  ['public·grocery 설명 달기', new RegExp(String.raw`\bcomment\s+on\s+\w+\s+${OTHER}\.`, 'gi')],
  ['public·grocery 표에 쓰기',
    new RegExp(String.raw`\b(insert\s+into|update|delete\s+from|truncate(\s+table)?)\s+(only\s+)?${OTHER}\.`, 'gi')],
  ['public·grocery 표를 실시간 목록에 넣고 빼기',
    new RegExp(String.raw`\balter\s+publication\s+\w+\s+(add|drop|set)\s+table\b[^;]*?\b${OTHER}\.`, 'gi')],
  // 스키마를 빠뜨리면 search_path를 따라 public에 생긴다. 선택 낱말(if exists, only, function 따위)은 부정 앞보기 안에 넣는다
  // (밖에 두면 그 낱말을 건너뛰고 되짚어 'if'·'only'를 이름으로 잘못 잡는다). 'on'은 문장의 첫 'on'만 본다.
  ['recipe 밖에 만들기(스키마 없음 포함)',
    /\b(create|alter|drop)\s+(or\s+replace\s+)?(table|view|materialized\s+view|function|procedure|type|domain|sequence)\s+(?!(if\s+(not\s+)?exists\s+)?(only\s+)?recipe\.)[\w"]+/gi],
  ['recipe 밖의 표에 인덱스·트리거·정책 걸기',
    /\b(create|drop)\s+(unique\s+)?(index|trigger|policy)\b(?:(?!\bon\s)[^;])*\bon\s+(?!(only\s+)?recipe\.)[\w"]+/gi],
  ['recipe 밖의 권한 바꾸기',
    /\b(grant|revoke)\b(?:(?!\bon\s)[^;])*\bon\s+(?!(table\s+|function\s+|sequence\s+|schema\s+|all\s+(tables|functions|sequences)\s+in\s+schema\s+)?recipe\b)\w+/gi],
  ['recipe 말고 다른 스키마 만들기', /\b(create|alter|drop)\s+schema\s+(?!(if\s+(not\s+)?exists\s+)?recipe\b)\w+/gi],
]

/** 위반한 곳: '규칙 (줄 N): 문장 앞부분' */
export function boundaryViolations(sql: string): string[] {
  const text = stripComments(sql)
  const found: string[] = []
  for (const [rule, re] of RULES) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length
      found.push(`${rule} (줄 ${line}): ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  return found
}

describe('레시피 마이그레이션은 recipe 스키마만 바꾼다', () => {
  const recipeFiles = MIGRATION_FILES.filter(isRecipe)

  it('레시피 파일 1개 이상이 대상이다', () => {
    expect(recipeFiles.length).toBeGreaterThanOrEqual(1)
  })

  it.each(recipeFiles)('%s', (f) => {
    expect(boundaryViolations(readMigration(f))).toEqual([])
  })

  it('검사가 실제로 잡는다', () => {
    const bad = [
      'alter table public.transactions add column x int;',
      'create or replace function public.f() returns int language sql as $$ select 1 $$;',
      'create policy p on public.members for select using (true);',
      'grant select on public.transactions to anon;',
      "insert into public.categories (name) values ('x');",
      "update public.members set display_name = 'x';",
      'create index i on public.transactions (amount);',
      'alter publication supabase_realtime add table recipe.inbox, public.transactions;',
      // grocery도 건드리지 않는다
      'alter table grocery.items add column recipe_id uuid;',
      "insert into grocery.items (household_id, name, category) values (null, 'x', '기타');",
      'delete from grocery.items;',
      'create trigger t after insert on grocery.items for each row execute function recipe.f();',
      'grant select on grocery.items to service_role;',
      'grant usage on schema grocery to anon;',
      'alter publication supabase_realtime add table grocery.items;',
      // 스키마를 빠뜨리거나 다른 스키마에 만들기
      'create table inbox (id uuid primary key);',
      'create function claim_job() returns void language sql as $$ select 1 $$;',
      'create or replace function private.f() returns int language sql as $$ select 1 $$;',
      'create index i on private.x (a);',
      'create schema if not exists recipes;',
      'create table if not exists inbox (a int);',
      'grant execute on function private.is_household_member(uuid) to anon;',
      'revoke all on schema private from authenticated;',
    ]
    for (const sql of bad) expect(boundaryViolations(sql), sql).not.toEqual([])
  })

  it('참조·읽기와 recipe 안의 일은 허용한다', () => {
    const ok = [
      'create schema if not exists recipe;',
      'revoke all on schema recipe from public, anon;',
      'grant usage on schema recipe to authenticated, service_role;',
      'create table recipe.t (household_id uuid references public.households (id) on delete cascade);',
      'create policy p on recipe.inbox for select using ((select private.is_household_member(household_id)));',
      'create function recipe.f() returns setof uuid language sql as $$ select user_id from public.members $$;',
      'foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)',
      'create unique index inbox_open_key on recipe.inbox (household_id, source_key) where state in (\'waiting\');',
      'create trigger t before update on recipe.recipes for each row execute function recipe.f();',
      'revoke execute on function recipe.claim_job(timestamptz) from public, anon, authenticated;',
      'grant update (memo, rating) on recipe.recipes to authenticated;',
      'alter publication supabase_realtime add table recipe.inbox, recipe.recipes;',
      '-- alter table public.transactions add column x int;',
      '-- insert into grocery.items values (1);',
      'create table if not exists recipe.t (a int);',
      'alter table only recipe.t add column x int;',
      'drop function if exists recipe.f(int);',
      'create index if not exists i on recipe.t (a);',
      'grant select, insert, update, delete on recipe.recipes, recipe.ingredients to service_role;',
      'grant select on all tables in schema recipe to service_role;',
    ]
    for (const sql of ok) expect(boundaryViolations(sql), sql).toEqual([])
  })
})

describe('시험 DB 준비', () => {
  // tests/grocery/dbSetup.ts의 beforeGrocery는 첫 장보기 파일 앞에서 불린다. 레시피 파일은 모두 그 뒤라
  // 레시피 마이그레이션이 적용될 때는 가구·구성원이 이미 있다(공유 DB에 적용할 때와 같은 순서).
  it('레시피 파일은 모두 첫 장보기 파일보다 뒤에 적용된다', () => {
    const firstGrocery = MIGRATION_FILES.findIndex(isGrocery)
    const recipeIdx = MIGRATION_FILES.flatMap((f, i) => (isRecipe(f) ? [i] : []))
    expect(firstGrocery).toBeGreaterThanOrEqual(0)
    expect(recipeIdx.length).toBeGreaterThanOrEqual(1)
    for (const i of recipeIdx) expect(i).toBeGreaterThan(firstGrocery)
  })
})
