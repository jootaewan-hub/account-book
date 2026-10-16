// 문자·사진 분석 결과를 저장할 수 있는 초안으로 바꾸고, Edge Function을 부른다.
import type { CheckedBill, CheckedEntry } from '../../supabase/functions/extract-entries/extract'
import { canSplitInstallment, createInstallment } from './api'
import { uploadItemImage } from './itemImages'
import { DELIVERY_PLATFORMS, normalizePlatform, platformOf } from './platform'
import { sb } from './supabase'
import type { Category, PaymentMethod, Scope, Transaction, TxType } from './types'

export type { CheckedBill, CheckedEntry }

export interface DraftItem {
  name: string
  /** 상품이면 true, 배송비·할인 줄이면 false */
  is_product?: boolean
  quantity: number
  unit_price: number | null
  amount: number
  pack_size: number | null
  pack_unit: string | null
  /** 모델이 고른 이 상품의 분류 이름 */
  category?: string | null
  /** 분석 결과에서의 위치 '내역번호:품목번호' (잘라 둔 상품 사진을 찾을 때) */
  src?: string
  /** 상품 사진 위치 (몇 번째 이미지의 어느 영역) */
  image_box?: { image: number; left: number; top: number; right: number; bottom: number } | null
  /** 잘라 낸 상품 사진 (저장할 때 올린다) */
  photo?: { blob: Blob; url: string } | null
}

export interface Draft {
  key: string
  include: boolean
  type: TxType
  date: string
  time: string | null
  title: string
  /** 산 곳 (쿠팡·네이버 등). 매장이면 null */
  platform: string | null
  amount: number
  category_id: string | null
  payment_method_id: string | null
  scope: Scope
  memo: string | null
  items: DraftItem[]
  /** 할부 개월 수 (일시불이면 null) */
  installment: number | null
  /** 할부를 달마다 나눠 넣을지 (첫 회차는 산 날, 남은 회차는 고정 탭의 할부 항목) */
  splitInstallment: boolean
  /** 확인이 필요한 점 */
  warnings: string[]
}

export interface AnalyzeResult {
  entries: CheckedEntry[]
  note: string | null
  model: string
}

/** 'claude-haiku-5-5' 또는 'claude-haiku-5-5-20261001' → 'Claude Haiku 5.5' */
export function modelLabel(id: string | null | undefined): string | null {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id ?? '')
  if (!m) return id || null
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
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

const TITLE_MAX = 60

/** 상품 줄(배송비·할인 제외)의 이름으로 내역 이름을 만든다. 길면 '첫 상품 외 N건' */
export function productTitle(items: Pick<DraftItem, 'name' | 'amount' | 'is_product'>[]): string | null {
  const names = items.filter((it) => (it.is_product ?? true) && it.amount > 0 && !/^배송비/.test(it.name)).map((it) => it.name.trim())
  if (!names.length) return null
  const joined = names.join(', ')
  if (joined.length <= TITLE_MAX) return joined
  const rest = ` 외 ${names.length - 1}건`
  const first = names[0].length + rest.length > TITLE_MAX ? `${names[0].slice(0, TITLE_MAX - rest.length - 1)}…` : names[0]
  return names.length > 1 ? `${first}${rest}` : first
}

/** 플랫폼: 모델이 읽은 이름, 없으면 가맹점 이름으로 짐작 */
export function draftPlatform(e: Pick<CheckedEntry, 'platform' | 'merchant'>): string | null {
  return normalizePlatform(e.platform) ?? platformOf(e.merchant)
}

/** 내역 이름: 온라인 주문은 상품명, 배달·매장·카드 문자는 가게(가맹점) 이름 */
export function draftTitle(e: Pick<CheckedEntry, 'merchant' | 'items'>, platform: string | null): string {
  const merchantIsPlatform = !e.merchant || platformOf(e.merchant) !== null
  if (platform && DELIVERY_PLATFORMS.has(platform) && !merchantIsPlatform) return e.merchant
  if (platform) return productTitle(e.items) ?? e.merchant
  return e.merchant
}

export interface DraftContext {
  today: string
  methods: PaymentMethod[]
  categories: Category[]
  existing: Transaction[]
  fallbackMethodId: string | null
  fallbackScope: Scope
  /** 이 가맹점에서 지난번에 고른 결제수단 */
  rememberedMethod?: (merchant: string) => string | null
}

/** 상품 줄인가 (배송비·할인·0원 줄이 아닌가) */
export function isProductLine(it: Pick<DraftItem, 'name' | 'amount' | 'is_product'>): boolean {
  return (it.is_product ?? true) && it.amount > 0 && !/^배송비/.test(it.name.trim())
}

/** 상품이 두 개 이상이면 상품별 내역으로 나눌 수 있다 */
export function canSplit(e: Pick<CheckedEntry, 'items'>): boolean {
  return e.items.filter(isProductLine).length >= 2
}

/** 할인 합계(음수)를 상품 금액 비율로 나눈다. 반올림 차이는 가장 비싼 상품이 가져간다 */
export function allocateDiscount(amounts: number[], discount: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0)
  if (!discount || !total) return amounts.map(() => 0)
  const shares = amounts.map((a) => Math.round((discount * a) / total))
  shares[amounts.indexOf(Math.max(...amounts))] += discount - shares.reduce((s, a) => s + a, 0)
  return shares
}

/**
 * 분석 결과 한 건을 저장할 초안으로. split이면 상품마다 내역 하나로 나눈다:
 * 상품 금액은 그 줄 금액(할인 줄이 있으면 비율대로 나눠 뺌), 배송비 같은 상품 아닌 줄은 따로 한 건.
 */
export function entryDrafts(e: CheckedEntry, i: number, ctx: DraftContext, split: boolean): Draft[] {
  const shared: string[] = []
  const date = e.date ?? ctx.today
  if (!e.date) shared.push('날짜를 못 읽어서 오늘로 넣었어요.')
  const match = matchMethodDetailed(e, ctx.methods)
  const method = match.method ?? null
  const remembered = method ? null : ctx.rememberedMethod?.(e.merchant) ?? null
  const cardsInUse = ctx.methods.length > 0 // 카드를 등록해 쓰는 경우에만 카드 관련 안내
  if (cardsInUse && !match.method && match.reason === 'unknown_last4' && !remembered) {
    shared.push(`끝자리 ${e.card_last4} 카드가 설정에 없어요. 설정 > 결제수단에 끝 4자리를 넣어 두면 다음부터 자동으로 골라요.`)
  }
  if (cardsInUse && !match.method && match.reason === 'ambiguous' && !remembered) {
    shared.push(`${match.issuer ?? '같은 끝자리'} 카드가 여러 장이라 고르지 못했어요. 결제수단을 골라 주세요.`)
  }
  if (e.price_fixes) shared.push(...e.price_fixes)
  if (e.items_match === false) shared.push(`품목 합계 ${itemsSum(e.items).toLocaleString()}원이 결제 금액 ${e.amount.toLocaleString()}원과 달라요.`)
  if (e.is_cancellation) shared.push('승인 취소 문자예요. 원래 내역을 찾아 지워 주세요.')
  const platform = draftPlatform(e)
  const items: DraftItem[] = e.items.map((it, j) => ({ ...it, src: `${i}:${j}` }))

  const make = (key: string, title: string, amount: number, category: string | null, its: DraftItem[], memo: string | null): Draft => {
    const dup = sameTransaction({ date, amount, type: e.type }, ctx.existing)
    return {
      key, include: !e.is_cancellation && !dup, type: e.type, date, time: e.time, title, platform, amount,
      category_id: matchCategory(category, e.type, ctx.categories) ?? matchCategory(e.category, e.type, ctx.categories),
      payment_method_id: method?.id ?? remembered ?? (match.method === null && match.reason !== 'none' ? null : ctx.fallbackMethodId),
      scope: ctx.fallbackScope, memo, items: its,
      installment: e.type === 'expense' ? e.installment_months ?? null : null, splitInstallment: true,
      warnings: dup ? [`같은 날 같은 금액 내역이 이미 있어요${dup.title ? ` (${dup.title})` : ''}.`] : [],
    }
  }

  let out: Draft[]
  // 할부는 결제 한 건을 나눠 내는 것이라 상품별로 나누지 않는다
  if (!split || !canSplit(e) || e.installment_months) {
    out = [make(`${i}`, draftTitle(e, platform), e.amount, e.category, items, null)]
  } else {
    const products = items.filter(isProductLine)
    const extras = items.filter((it) => it.amount > 0 && !isProductLine(it)) // 배송비 등
    const discount = items.filter((it) => it.amount < 0).reduce((s, it) => s + it.amount, 0)
    const shares = allocateDiscount(products.map((p) => p.amount), discount)
    out = [
      ...products.map((p, k) => make(`${i}-${k}`, p.name.slice(0, 60), Math.max(p.amount + shares[k], 1), p.category ?? null, [p],
        shares[k] ? `할인 ${(-shares[k]).toLocaleString()}원 나눠 뺌 (원래 ${p.amount.toLocaleString()}원)` : null)),
      ...extras.map((x, k) => make(`${i}-x${k}`, x.name.slice(0, 60), x.amount, x.category ?? null, [], null)),
    ]
  }
  out[0].warnings.unshift(...shared)
  return out
}

// 상품 하나짜리 초안은 할인을 나누기 전 상품 금액으로 비교한다 (같은 상품이 묶음 주문과 따로 나온 경우)
const sameKey = (d: Pick<Draft, 'date' | 'amount' | 'title' | 'items'>) =>
  `${d.date}|${d.items?.length === 1 ? d.items[0].amount : d.amount}|${d.title.replace(/[\s[\]()]/g, '').toLowerCase()}`

/** 한 번의 분석에서 같은 상품(같은 날·금액·이름)이 또 나오면 빼 둔다 (목록·상세 화면을 함께 찍은 경우 등) */
export function markRepeats(drafts: Draft[], before: Draft[] = []): Draft[] {
  const seen = new Set(before.map(sameKey))
  return drafts.map((d) => {
    const k = sameKey(d)
    if (seen.has(k)) return { ...d, include: false, warnings: [...d.warnings, '같은 상품이 위에 이미 있어서 뺐어요. 따로 산 것이면 다시 체크하세요.'] }
    seen.add(k)
    return d
  })
}

/** 여러 건을 초안으로. 기본은 상품이 두 개 이상인 주문을 상품별로 나눈다 */
export function toDrafts(entries: CheckedEntry[], ctx: DraftContext, split: (e: CheckedEntry) => boolean = canSplit): Draft[] {
  return markRepeats(entries.flatMap((e, i) => entryDrafts(e, i, ctx, split(e))))
}

async function errorPayload(error: unknown): Promise<{ code?: string; message?: string } | null> {
  const ctx = (error as { context?: unknown }).context
  if (ctx instanceof Response) {
    try { return ((await ctx.json()) as { error?: { code?: string; message?: string } }).error ?? null } catch { return null }
  }
  return null
}

export type AnalyzeBody =
  | { kind: 'text'; text: string; today: string }
  | { kind: 'image'; mode: 'receipt' | 'shop' | 'bill'; images: { media_type: 'image/jpeg'; data: string; width: number; height: number }[]; today: string }

export function analyze(body: AnalyzeBody): Promise<AnalyzeResult> {
  return invoke<AnalyzeResult>(body)
}

export interface BillResult {
  bill: CheckedBill
  model: string
}

/** 관리비 고지서 사진(같은 고지서의 여러 부분)을 읽는다 */
export function analyzeBill(images: { media_type: 'image/jpeg'; data: string; width: number; height: number }[], today: string): Promise<BillResult> {
  return invoke<BillResult>({ kind: 'image', mode: 'bill', images, today })
}

async function invoke<T>(body: AnalyzeBody): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await sb().functions.invoke<T>('extract-entries', { body })
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

/** 한 번에 보내는 사진 수. Edge Function이 150초 안에 끝나도록 나눠 보낸다 */
export const BATCH_SIZE = 5

type BatchImage = { media_type: 'image/jpeg'; data: string; width: number; height: number }

export interface BatchResult extends AnalyzeResult {
  /** 읽지 못한 묶음 (사진 번호는 1부터) */
  failed: { from: number; to: number; message: string }[]
}

/** 묶음별 결과를 합친다. 상품 사진 위치의 이미지 번호를 전체 사진 기준으로 바꾼다 */
export function mergeBatches(results: (AnalyzeResult | Error)[], sizes: number[]): BatchResult {
  const out: BatchResult = { entries: [], note: null, model: '', failed: [] }
  const notes: string[] = []
  let offset = 0
  results.forEach((r, k) => {
    if (r instanceof Error) {
      out.failed.push({ from: offset + 1, to: offset + sizes[k], message: r.message })
    } else {
      out.entries.push(...r.entries.map((e) => ({
        ...e, items: e.items.map((it) => (it.image_box ? { ...it, image_box: { ...it.image_box, image: it.image_box.image + offset } } : it)),
      })))
      if (r.note) notes.push(results.length > 1 ? `사진 ${offset + 1}~${offset + sizes[k]}: ${r.note}` : r.note)
      out.model ||= r.model
    }
    offset += sizes[k]
  })
  out.note = notes.join('\n') || null
  return out
}

/** 사진을 BATCH_SIZE장씩 나눠 동시에 분석한다. 일부 묶음이 실패해도 나머지 결과는 돌려준다 */
export async function analyzeImages(
  images: BatchImage[], mode: 'receipt' | 'shop', today: string, onProgress?: (done: number, total: number) => void,
): Promise<BatchResult> {
  const batches: BatchImage[][] = []
  for (let i = 0; i < images.length; i += BATCH_SIZE) batches.push(images.slice(i, i + BATCH_SIZE))
  let done = 0
  const results = await Promise.all(batches.map((b) =>
    analyze({ kind: 'image', mode, today, images: b })
      .catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))
      .finally(() => onProgress?.(++done, batches.length))))
  const merged = mergeBatches(results, batches.map((b) => b.length))
  // 전부 실패하면 첫 오류를 그대로 알린다
  const firstError = results.find((r): r is Error => r instanceof Error)
  if (merged.failed.length === batches.length && firstError) throw firstError
  return merged
}

/**
 * 초안 하나를 저장한다. 할부를 나눠 넣으면 첫 회차만 이 날짜의 내역으로 넣고,
 * 남은 회차는 반복 항목(할부)으로 등록해 날짜가 되면 자동으로 들어가게 한다.
 * 저장한 것이 할부 나눠 넣기였으면 true.
 */
export async function saveDraft(householdId: string, d: Draft, source: 'text' | 'photo'): Promise<boolean> {
  const months = d.type === 'expense' ? d.installment : null
  const title = d.title.trim().slice(0, 60)
  const plan = months && d.splitInstallment && canSplitInstallment(d.amount, months)
    ? await createInstallment(householdId, {
      title, total: d.amount, months, date: d.date, category_id: d.category_id, payment_method_id: d.payment_method_id, scope: d.scope,
    })
    : null
  const memo = [plan ? plan.memo : months ? `${months}개월 할부` : null, d.memo].filter(Boolean).join(', ') || null
  const recurringId = plan?.recurringId ?? null

  // 상품 사진을 먼저 올리고 경로를 품목에 붙인다. 사진 올리기가 실패해도 내역은 저장한다
  const paths = await Promise.all(d.items.map((it) =>
    it.photo ? uploadItemImage(householdId, it.photo.blob).catch(() => null) : Promise.resolve(null)))
  const { error } = await sb().rpc('add_transaction_with_items', {
    p_household_id: householdId,
    p_tx: {
      type: d.type, occurred_on: d.date, occurred_at: d.time, amount: plan ? plan.first : d.amount, title, memo,
      category_id: d.category_id, payment_method_id: d.payment_method_id, scope: d.scope, source,
      platform: normalizePlatform(d.platform),
    },
    p_items: d.items.map((it, i) => ({
      name: it.name, quantity: it.quantity, unit_price: it.unit_price, amount: it.amount,
      pack_size: it.pack_size, pack_unit: it.pack_unit, image_path: paths[i],
    })),
  })
  if (error) {
    // 첫 회차를 못 넣었으면 할부 항목도 지워 둘이 어긋나지 않게 한다
    if (recurringId) await sb().from('recurring').delete().eq('id', recurringId)
    throw new Error(error.message)
  }
  return plan !== null
}
