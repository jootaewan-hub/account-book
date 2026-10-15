// 구글 시트 연동용 CSV. 시트 칸에 =IMPORTDATA("<이 주소>?t=<토큰>")를 넣으면 내역이 채워지고 주기적으로 새로 고쳐진다.
// 로그인 대신 가구별 비밀 토큰으로 확인한다(verify_jwt 끔). 토큰 확인은 DB 함수 export_rows가 한다.
import { createClient } from '@supabase/supabase-js'
import { toCsv, type ExportRow } from './csv.ts'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    if (keys.default) return keys.default
  } catch { /* 예전 형식 키로 넘어간다 */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') return new Response('GET만 받아요', { status: 405 })
  const url = new URL(req.url)
  const token = url.searchParams.get('t') ?? ''
  if (token.length < 48) return new Response('주소가 올바르지 않아요', { status: 400 })
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.rpc('export_rows', { p_token: token })
  if (error) {
    console.error('export_rows_failed', error.message)
    return new Response('내역을 읽지 못했어요', { status: 500 })
  }
  const rows = (data as ExportRow[]).filter((r) =>
    (!DATE_RE.test(from) || r.occurred_on >= from) && (!DATE_RE.test(to) || r.occurred_on <= to))
  // 엑셀에서 한글이 깨지지 않도록 내려받기(dl=1)일 때만 BOM을 붙인다. 구글 시트는 BOM 없이 읽는다.
  const body = (url.searchParams.get('dl') === '1' ? '﻿' : '') + toCsv(rows)
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(url.searchParams.get('dl') === '1' ? { 'Content-Disposition': 'attachment; filename="account-book.csv"' } : {}),
    },
  })
})
