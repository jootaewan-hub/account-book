// 내역을 CSV로 만든다. Edge Function(구글 시트 IMPORTDATA)과 앱(파일 내려받기)이 함께 쓴다.

export interface ExportRow {
  occurred_on: string
  occurred_at: string | null
  type: string
  amount: number | string
  title: string | null
  platform: string | null
  category: string | null
  scope: string
  source: string
  entered_by: string | null
  memo: string | null
  items: string | null
}

export const HEADERS = ['날짜', '시간', '구분', '금액', '내용', '플랫폼', '분류', '용도', '입력 방식', '입력한 사람', '메모', '품목']

const TYPE: Record<string, string> = { expense: '지출', income: '수입' }
const SCOPE: Record<string, string> = { shared: '공동', husband: '남편', wife: '아내', child: '자녀' }
const SOURCE: Record<string, string> = { manual: '직접', text: '문자', photo: '사진', recurring: '반복' }

export interface ExportItem {
  name: string
  quantity: number
  unit_price: number | null
  amount: number
  pack_size: number | null
  pack_unit: string | null
}

/**
 * 품목 한 줄: '물티슈 100매 x 10팩 x2 19600 (개당 9800) (1매당 9.8)'.
 * DB 함수 export_rows_v2(구글 시트용)와 같은 모양이어야 한다. 단위당 가격은 100 이상이면 정수, 아니면 소수 첫째 자리.
 */
export function itemText(i: ExportItem): string {
  const q = Number(i.quantity)
  let s = `${i.name}${q !== 1 ? ` x${q}` : ''} ${i.amount}`
  if (i.unit_price !== null && q !== 1) s += ` (개당 ${i.unit_price})`
  if (i.pack_size && i.pack_size > 0 && i.pack_unit && i.amount > 0) {
    const metric = i.pack_unit === 'g' || i.pack_unit === 'ml'
    const x = (i.amount / (q * i.pack_size)) * (metric ? 100 : 1)
    const v = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10
    s += ` (${metric ? `100${i.pack_unit}` : `1${i.pack_unit}`}당 ${v})`
  }
  return s
}

/** 쉼표·따옴표·줄바꿈은 따옴표로 감싸고, =·+·-·@로 시작하는 글자는 수식으로 실행되지 않게 앞에 '를 붙인다 */
export function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v)
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [HEADERS.join(',')]
  for (const r of rows) {
    lines.push([
      cell(r.occurred_on),
      cell(r.occurred_at ? r.occurred_at.slice(0, 5) : null),
      cell(TYPE[r.type] ?? r.type),
      cell(Number(r.amount)),
      cell(r.title),
      cell(r.platform),
      cell(r.category),
      cell(SCOPE[r.scope] ?? r.scope),
      cell(SOURCE[r.source] ?? r.source),
      cell(r.entered_by),
      cell(r.memo),
      cell(r.items),
    ].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
