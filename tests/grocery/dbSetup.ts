// 장보기 DB 테스트의 준비: 실제 마이그레이션 전부(가계부 + 장보기)를 파일 이름 순서로 PGlite에 적용한다.
// 실제처럼 사용자가 먼저 있고(20261015170000부터 새 사용자 행이 막힌다), 가구·구성원은 장보기 마이그레이션보다 먼저 있다.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { SUPABASE_STUB } from '../supabaseStub'

const DIR = new URL('../../supabase/migrations/', import.meta.url)

/** 마이그레이션 파일 이름, 이름 순서 */
export const MIGRATION_FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

export const readMigration = (f: string) => readFileSync(new URL(f, DIR), 'utf8')

/** 장보기 마이그레이션인지(grocery 스키마만 바꾸는 파일) */
export const isGrocery = (f: string) => f.includes('_grocery_')

/**
 * 새 DB를 만든다. users는 auth.users에 먼저 넣고, beforeGrocery는 가계부 마이그레이션 뒤·장보기 마이그레이션 앞에 부른다
 * (공유 DB에 장보기를 적용할 때 가구·구성원이 이미 있던 것과 같은 순서).
 */
export async function freshDb(users: string[], beforeGrocery?: (db: PGlite) => Promise<void>): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  for (const [i, id] of users.entries()) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `u${i}@x`])
  let seeded = false
  for (const f of MIGRATION_FILES) {
    if (isGrocery(f) && !seeded) {
      await beforeGrocery?.(db)
      seeded = true
    }
    await db.exec(readMigration(f))
  }
  if (!seeded) await beforeGrocery?.(db)
  return db
}
