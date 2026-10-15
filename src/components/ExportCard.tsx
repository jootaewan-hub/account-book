import { useState } from 'react'
import { itemText, toCsv, type ExportRow } from '../../supabase/functions/export-csv/csv'
import { exportToken, friendlyError } from '../lib/api'
import { addMonths, monthRange } from '../lib/dates'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import { sb } from '../lib/supabase'

interface Props {
  householdId: string
  today: string
  lookup: Lookup
  toast: (msg: string) => void
}

type Period = 'month' | 'prev' | 'year' | 'all'
const PERIOD_LABEL: Record<Period, string> = { month: '이번 달', prev: '지난달', year: '올해', all: '전체' }

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-csv`

function range(p: Period, today: string): { from?: string; to?: string } {
  const ym = today.slice(0, 7)
  const r = (m: string) => { const { start, end } = monthRange(m); return { from: start, to: end } }
  if (p === 'month') return r(ym)
  if (p === 'prev') return r(addMonths(ym, -1))
  if (p === 'year') return { from: `${ym.slice(0, 4)}-01-01`, to: `${ym.slice(0, 4)}-12-31` }
  return {}
}


export function ExportCard({ householdId, today, lookup, toast }: Props) {
  const [period, setPeriod] = useState<Period>('month')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const { from, to } = range(period, today)
      let q = sb().from('transactions')
        .select('occurred_on, occurred_at, type, amount, title, platform, memo, scope, source, created_by, category_id, transaction_items(name, quantity, unit_price, amount, pack_size, pack_unit, sort)')
        .eq('household_id', householdId)
      if (from) q = q.gte('occurred_on', from)
      if (to) q = q.lte('occurred_on', to)
      const { data, error } = await q.order('occurred_on').order('created_at')
      if (error) throw new Error(error.message)
      const rows: ExportRow[] = (data ?? []).map((t) => {
        const role = lookup.roleOf(t.created_by)
        const items = [...(t.transaction_items ?? [])].sort((a, b) => a.sort - b.sort)
        return {
          occurred_on: t.occurred_on, occurred_at: t.occurred_at, type: t.type, amount: Number(t.amount), title: t.title, platform: t.platform,
          category: t.category_id ? lookup.categoryName(t.category_id) : null,
          scope: t.scope, source: t.source, entered_by: role ? SCOPE_LABEL[role] : lookup.personLabel(t.created_by), memo: t.memo,
          items: items.length ? items.map((i) => itemText({
            name: i.name, quantity: Number(i.quantity), unit_price: i.unit_price === null ? null : Number(i.unit_price), amount: Number(i.amount),
            pack_size: i.pack_size === null ? null : Number(i.pack_size), pack_unit: i.pack_unit,
          })).join(', ') : null,
        }
      })
      const name = `가계부_${PERIOD_LABEL[period]}_${today}.csv`
      const file = new File(['﻿' + toCsv(rows)], name, { type: 'text/csv' })
      // iPhone에서는 공유 시트로 '파일에 저장'·카톡 전송 등을 고를 수 있다
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name }).catch(() => undefined)
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url; a.download = name; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
      toast(`${rows.length}건을 내보냈어요`)
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function showLink(rotate: boolean) {
    setBusy(true)
    try {
      setToken(await exportToken(householdId, rotate))
      setConfirmRotate(false)
      if (rotate) toast('새 주소를 만들었어요. 이전 주소는 더 이상 안 열려요')
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const formula = token ? `=IMPORTDATA("${FUNCTION_URL}?t=${token}")` : ''

  return (
    <div className="card">
      <h3 className="section-title">내보내기</h3>
      <div className="form-grid">
        <select className="input" aria-label="내보낼 기간" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
        </select>
        <button className="ghost" disabled={busy} onClick={download}>CSV 파일로 받기</button>
      </div>
      <p className="note">엑셀·구글 시트·Numbers에서 열 수 있어요. 구글 시트는 파일 → 가져오기 → 업로드로 넣습니다.</p>

      <h3 className="section-title" style={{ marginTop: 16 }}>구글 시트에 자동으로 채우기</h3>
      {!token ? (
        <button className="ghost full-btn" disabled={busy} onClick={() => showLink(false)}>연결 수식 보기</button>
      ) : (
        <>
          <div className="formula">{formula}</div>
          <div className="form-grid">
            <button className="ghost" onClick={async () => {
              try { await navigator.clipboard.writeText(formula); toast('수식을 복사했어요') } catch { toast('길게 눌러 직접 복사해 주세요') }
            }}>수식 복사</button>
            <button className="ghost" disabled={busy} onClick={() => (confirmRotate ? showLink(true) : setConfirmRotate(true))}>
              {confirmRotate ? '한 번 더 누르면 새 주소' : '주소 새로 만들기'}
            </button>
          </div>
          <ol className="steps">
            <li>PC에서 sheets.new 로 새 구글 시트를 엽니다.</li>
            <li>A1 칸에 위 수식을 붙여넣고 Enter. 처음 한 번 "액세스 허용"이 나오면 누릅니다.</li>
            <li>전체 내역이 날짜순으로 채워지고, 구글 시트가 주기적으로 다시 읽어 새 내역이 반영됩니다(주기는 구글이 정함).</li>
          </ol>
          <p className="note">이 수식(주소)을 아는 사람은 누구나 내역을 볼 수 있어요. 시트를 다른 사람과 공유하지 말고, 새어 나갔다면 "주소 새로 만들기"를 누르세요.</p>
        </>
      )}
    </div>
  )
}
