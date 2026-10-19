// D-003 경계: 장보기 마이그레이션은 grocery 스키마만 만들고 바꾼다. 가계부 public 표는 참조·읽기만 한다.
// 장보기 파일에 public 객체를 만들거나 바꾸거나 쓰는 문이 들어오면 이 테스트가 파일 이름과 줄을 알려 주며 실패한다.
import { describe, expect, it } from 'vitest'
import { freshDb, isGrocery, MIGRATION_FILES, readMigration } from './dbSetup'

// 주석을 지우되 줄 수는 그대로 둔다(실패 메시지의 줄 번호를 맞추려고)
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/--[^\n]*/g, '')

const PUBLIC_WRITES: ReadonlyArray<[string, RegExp]> = [
  ['public 객체 만들기·바꾸기·지우기',
    /\b(create|alter|drop)\s+(or\s+replace\s+)?(unique\s+)?(table|view|materialized\s+view|function|procedure|type|sequence|index|trigger|policy|schema)\s+(if\s+(not\s+)?exists\s+)?(only\s+)?public\./gi],
  ['public 표에 인덱스·트리거·정책 걸기', /\b(create|drop)\s+(unique\s+)?(index|trigger|policy)\b[^;]*?\bon\s+(only\s+)?public\./gi],
  ['public 권한 바꾸기', /\b(grant|revoke)\b[^;]*?\bon\s+(table\s+|function\s+|sequence\s+|schema\s+|all\s+(tables|functions|sequences)\s+in\s+schema\s+)?public\b/gi],
  ['public 설명 달기', /\bcomment\s+on\s+\w+\s+public\./gi],
  ['public 표에 쓰기', /\b(insert\s+into|update|delete\s+from|truncate(\s+table)?)\s+(only\s+)?public\./gi],
  ['public 표를 실시간 목록에 넣고 빼기', /\balter\s+publication\s+\w+\s+(add|drop|set)\s+table\b[^;]*?\bpublic\./gi],
]

/** 위반한 곳: '규칙 (줄 N): 문장 앞부분' */
export function publicWrites(sql: string): string[] {
  const text = stripComments(sql)
  const found: string[] = []
  for (const [rule, re] of PUBLIC_WRITES) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length
      found.push(`${rule} (줄 ${line}): ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  return found
}

describe('장보기 마이그레이션은 public을 바꾸지 않는다(D-003)', () => {
  const groceryFiles = MIGRATION_FILES.filter(isGrocery)

  it('장보기 파일 7개 이상이 대상이다', () => {
    expect(groceryFiles.length).toBeGreaterThanOrEqual(7)
  })

  it.each(groceryFiles)('%s', (f) => {
    expect(publicWrites(readMigration(f))).toEqual([])
  })

  it('검사가 실제로 잡는다', () => {
    const bad = [
      'alter table public.transactions add column x int;',
      'create or replace function public.f() returns int language sql as $$ select 1 $$;',
      'create policy p on public.members for select using (true);',
      'grant select on public.transactions to anon;',
      'insert into public.categories (name) values (\'x\');',
      'update public.members set display_name = \'x\';',
      'create index i on public.transactions (amount);',
      'alter publication supabase_realtime add table grocery.items, public.transactions;',
    ]
    for (const sql of bad) expect(publicWrites(sql), sql).not.toEqual([])
  })

  it('참조·읽기는 허용한다', () => {
    const ok = [
      'create table grocery.t (household_id uuid references public.households (id) on delete cascade);',
      'create policy p on grocery.items for select using ((select private.is_household_member(household_id)));',
      'create function grocery.f() returns setof uuid language sql as $$ select user_id from public.members $$;',
      'foreign key (household_id, added_by) references public.members (household_id, user_id) on delete set null (added_by)',
      '-- alter table public.transactions add column x int;',
      'alter publication supabase_realtime add table grocery.items;',
    ]
    for (const sql of ok) expect(publicWrites(sql), sql).toEqual([])
  })
})

describe('마이그레이션 전체', () => {
  it('가계부 + 장보기 전부를 이름 순서로 빈 DB에 적용해도 오류가 없다', async () => {
    const db = await freshDb(['00000000-0000-4000-8000-00000000000a'])
    const r = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema = 'grocery'`)
    expect(r.rows[0].n).toBeGreaterThan(0)
    await db.close()
  })
})
