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

const norm = (s: string) => s.replace(/[\s()·._-]+/g, '').toLowerCase()

// 카드사·은행·간편결제 이름과 문자에 나오는 다른 표기. 긴 표기를 먼저 맞춘다(예: 케이뱅크 ≠ KB)
const ISSUERS: [string, string[]][] = [
  ['신한', ['신한', 'shinhan']],
  ['국민', ['kb국민', '국민', 'kb', '케이비']],
  ['현대', ['현대', 'hyundai']],
  ['삼성', ['삼성', 'samsung']],
  ['롯데', ['롯데', 'lotte']],
  ['하나', ['하나', 'hana', '외환']],
  ['우리', ['우리', 'woori']],
  ['농협', ['nh농협', '농협', 'nh']],
  ['비씨', ['bc', '비씨']],
  ['씨티', ['씨티', 'citi']],
  ['기업', ['ibk', '기업']],
  ['케이뱅크', ['케이뱅크', 'kbank']],
  ['카카오뱅크', ['카카오뱅크', '카뱅']],
  ['카카오페이', ['카카오페이', 'kakaopay']],
  ['네이버페이', ['네이버페이', 'naverpay', 'npay', 'n페이']],
  ['토스', ['토스', 'toss']],
  ['페이코', ['페이코', 'payco']],
  ['우체국', ['우체국']],
  ['수협', ['수협']],
  ['새마을', ['새마을', 'mg']],
]
const ALIASES = ISSUERS.flatMap(([id, names]) => names.map((n) => [n, id] as const)).sort((a, b) => b[0].length - a[0].length)

/** 이름에서 카드사·은행을 찾는다 (예: "신한 체크" → 신한, "KB국민카드" → 국민) */
export function issuerOf(text: string | null): string | null {
  if (!text) return null
  const t = norm(text)
  return ALIASES.find(([alias]) => t.includes(alias))?.[1] ?? null
}

/** "1234" 또는 가려진 "1*3*"가 등록된 끝 4자리와 맞는지 */
export function last4Matches(pattern: string, last4: string | null): boolean {
  if (!last4 || pattern.length !== 4) return false
  return [...pattern].every((ch, i) => ch === '*' || ch === last4[i])
}

function narrowByKind(list: PaymentMethod[], hint: string): PaymentMethod[] {
  const h = norm(hint)
  for (const word of ['체크', '신용', '법인']) {
    if (!h.includes(word)) continue
    const hit = list.filter((m) => norm(m.name).includes(word))
    if (hit.length) return hit
  }
  return list
}

export type MethodMatch = { method: PaymentMethod } | { method: null; reason: 'none' | 'unknown_last4' | 'ambiguous'; issuer: string | null }

/**
 * 카드를 여러 장 써도 고를 수 있게: 끝 4자리(가려진 자리 포함) → 카드사 이름 → 체크/신용 구분 순으로 좁힌다.
 * 하나로 좁혀지지 않으면 고르지 않고 이유를 돌려준다.
 */
export function matchMethodDetailed(e: Pick<CheckedEntry, 'card_last4' | 'payment_hint'>, methods: PaymentMethod[]): MethodMatch {
  const issuer = issuerOf(e.payment_hint)
  const sameIssuer = (list: PaymentMethod[]) => (issuer ? list.filter((m) => issuerOf(m.name) === issuer) : list)
  if (e.card_last4) {
    let hit = methods.filter((m) => last4Matches(e.card_last4!, m.last4))
    if (hit.length > 1) hit = sameIssuer(hit)
    if (hit.length > 1 && e.payment_hint) hit = narrowByKind(hit, e.payment_hint)
    if (hit.length === 1) return { method: hit[0] }
    if (hit.length > 1) return { method: null, reason: 'ambiguous', issuer }
  }
  if (issuer) {
    let hit = sameIssuer(methods)
    if (hit.length > 1 && e.payment_hint) hit = narrowByKind(hit, e.payment_hint)
    if (hit.length === 1 && !(e.card_last4 && hit[0].last4)) return { method: hit[0] }
    if (hit.length > 1) return { method: null, reason: 'ambiguous', issuer }
  }
  return { method: null, reason: e.card_last4 ? 'unknown_last4' : 'none', issuer }
}

export function matchMethod(e: Pick<CheckedEntry, 'card_last4' | 'payment_hint'>, methods: PaymentMethod[]): PaymentMethod | null {
  return matchMethodDetailed(e, methods).method
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
  /** 이 가맹점에서 지난번에 고른 결제수단 */
  rememberedMethod?: (merchant: string) => string | null
}): Draft[] {
  return entries.map((e, i) => {
    const warnings: string[] = []
    const date = e.date ?? ctx.today
    if (!e.date) warnings.push('날짜를 못 읽어서 오늘로 넣었어요.')
    const match = matchMethodDetailed(e, ctx.methods)
    const method = match.method ?? null
    const remembered = method ? null : ctx.rememberedMethod?.(e.merchant) ?? null
    if (!match.method && match.reason === 'unknown_last4' && !remembered) {
      warnings.push(`끝자리 ${e.card_last4} 카드가 설정에 없어요. 설정 > 결제수단에 끝 4자리를 넣어 두면 다음부터 자동으로 골라요.`)
    }
    if (!match.method && match.reason === 'ambiguous' && !remembered) {
      warnings.push(`${match.issuer ?? '같은 끝자리'} 카드가 여러 장이라 고르지 못했어요. 결제수단을 골라 주세요.`)
    }
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
      payment_method_id: method?.id ?? remembered ?? (match.method === null && match.reason !== 'none' ? null : ctx.fallbackMethodId),
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
    if ((p?.code === 'wif_denied' || p?.code === 'wif_aud_missing') && attempt === 0) {
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
