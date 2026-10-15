// 내역을 CSV로 만든다. Edge Function(구글 시트 IMPORTDATA)과 앱(파일 내려받기)이 함께 쓴다.

export interface ExportRow {
  occurred_on: string
  occurred_at: string | null
  type: string
  amount: number | string
  title: string | null
  category: string | null
  method: string | null
  method_owner: string | null
  scope: string
  source: string
  entered_by: string | null
  memo: string | null
  items: string | null
}

export const HEADERS = ['날짜', '시간', '구분', '금액', '내용', '분류', '결제수단', '결제수단 주인', '용도', '입력 방식', '입력한 사람', '메모', '품목']

const TYPE: Record<string, string> = { expense: '지출', income: '수입' }
const OWNER: Record<string, string> = { husband: '남편', wife: '아내', shared: '공동', entered_by: '입력한 사람' }
const SCOPE: Record<string, string> = { shared: '공동', husband: '남편', wife: '아내' }
const SOURCE: Record<string, string> = { manual: '직접', text: '문자', photo: '사진', recurring: '반복' }

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
      cell(r.category),
      cell(r.method),
      cell(r.method_owner ? OWNER[r.method_owner] ?? r.method_owner : null),
      cell(SCOPE[r.scope] ?? r.scope),
      cell(SOURCE[r.source] ?? r.source),
      cell(r.entered_by),
      cell(r.memo),
      cell(r.items),
    ].join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
