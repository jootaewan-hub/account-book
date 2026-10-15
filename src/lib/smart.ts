// 문자·사진 분석 결과를 저장할 수 있는 초안으로 바꾸고, Edge Function을 부른다.
import type { CheckedEntry } from '../../supabase/functions/extract-entries/extract'
import { sb } from './supabase'
import type { Category, PaymentMethod, Scope, Transaction, TxType } from './types'

export type { CheckedEntry }

export interface DraftItem {
  name: string
  quantity: number
  unit_price: number | null
  amount: number
}

export interface Draft {
  key: string
  include: boolean
  type: TxType
  date: string
  time: string | null
  title: string
  amount: number
  category_id: string | null
  payment_method_id: string | null
  scope: Scope
  items: DraftItem[]
  /** 확인이 필요한 점 */
  warnings: string[]
}

export interface AnalyzeResult {
  entries: CheckedEntry[]
  note: string | null
  model: string
}

export class SmartError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

/** 끝 4자리 → 카드사·간편결제 이름 순으로 결제수단을 찾는다 */
export function matchMethod(e: Pick<CheckedEntry, 'card_last4' | 'payment_hint'>, methods: PaymentMethod[]): PaymentMethod | null {
  if (e.card_last4) {
    const byLast4 = methods.filter((m) => m.last4 === e.card_last4)
    if (byLast4.length === 1) return byLast4[0]
  }
  if (e.payment_hint) {
    const hint = norm(e.payment_hint)
    const byName = methods.filter((m) => {
      const name = norm(m.name)
      return name.length >= 2 && (hint.includes(name) || name.includes(hint))
    })
    if (byName.length === 1) return byName[0]
  }
  return null
}

export function matchCategory(name: string | null, type: TxType, categories: Category[]): string | null {
  if (!name) return null
  return categories.find((c) => c.type === type && c.name === name.trim())?.id ?? null
}

export function sameTransaction(d: Pick<Draft, 'date' | 'amount' | 'type'>, txs: Transaction[]): Transaction | undefined {
  return txs.find((t) => t.occurred_on === d.date && t.amount === d.amount && t.type === d.type)
}

export function itemsSum(items: DraftItem[]): number {
  return items.reduce((s, it) => s + it.amount, 0)
}

export function toDrafts(entries: CheckedEntry[], ctx: {
  today: string
  methods: PaymentMethod[]
  categories: Category[]
  existing: Transaction[]
  fallbackMethodId: string | null
  fallbackScope: Scope
}): Draft[] {
  return entries.map((e, i) => {
    const warnings: string[] = []
    const date = e.date ?? ctx.today
    if (!e.date) warnings.push('날짜를 못 읽어서 오늘로 넣었어요.')
    const method = matchMethod(e, ctx.methods)
    if (!method && e.card_last4) warnings.push(`끝자리 ${e.card_last4} 결제수단이 설정에 없어요.`)
    if (e.items_match === false) warnings.push(`품목 합계 ${itemsSum(e.items).toLocaleString()}원이 결제 금액과 달라요.`)
    if (e.is_cancellation) warnings.push('승인 취소 문자예요. 원래 내역을 찾아 지워 주세요.')
    const dup = sameTransaction({ date, amount: e.amount, type: e.type }, ctx.existing)
    if (dup) warnings.push(`같은 날 같은 금액 내역이 이미 있어요${dup.title ? ` (${dup.title})` : ''}.`)
    return {
      key: `${i}-${date}-${e.amount}`,
      include: !e.is_cancellation && !dup,
      type: e.type,
      date,
      time: e.time,
      title: e.merchant,
      amount: e.amount,
      category_id: matchCategory(e.category, e.type, ctx.categories),
      payment_method_id: method?.id ?? (e.card_last4 ? null : ctx.fallbackMethodId),
      scope: ctx.fallbackScope,
      items: e.items,
      warnings,
    }
  })
}

async function errorPayload(error: unknown): Promise<{ code?: string; message?: string } | null> {
  const ctx = (error as { context?: unknown }).context
  if (ctx instanceof Response) {
    try { return ((await ctx.json()) as { error?: { code?: string; message?: string } }).error ?? null } catch { return null }
  }
  return null
}

export async function analyze(body:
  | { kind: 'text'; text: string; today: string }
  | { kind: 'image'; image: { media_type: 'image/jpeg'; data: string }; today: string },
): Promise<AnalyzeResult> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await sb().functions.invoke<AnalyzeResult>('extract-entries', { body })
    if (!error && data) return data
    const p = await errorPayload(error)
    // WIF 토큰 교환이 거절되면 새 로그인 토큰으로 한 번 더 (재사용된 토큰·갱신 전 권한 정보 대비)
    if (p?.code === 'wif_denied' && attempt === 0) {
      await sb().auth.refreshSession()
      continue
    }
    if (p?.message) throw new SmartError(p.code ?? 'error', p.message)
    throw new SmartError('network', '분석 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  }
}

export async function saveDraft(householdId: string, d: Draft, source: 'text' | 'photo'): Promise<void> {
  const { error } = await sb().rpc('add_transaction_with_items', {
    p_household_id: householdId,
    p_tx: {
      type: d.type, occurred_on: d.date, occurred_at: d.time, amount: d.amount, title: d.title.trim().slice(0, 60),
      category_id: d.category_id, payment_method_id: d.payment_method_id, scope: d.scope, source,
    },
    p_items: d.items.map((it) => ({ name: it.name, quantity: it.quantity, unit_price: it.unit_price, amount: it.amount })),
  })
  if (error) throw new Error(error.message)
}
