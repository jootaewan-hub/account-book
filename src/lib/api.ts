import { addMonths, monthRange } from './dates'
import { removeItemImages } from './itemImages'
import { utilityItemForBill } from './bills'
import { installmentPlan } from './recurring'
import { sb } from './supabase'
import type {
  Anniversary, AnniversaryInput, CalEvent, EventInput, BillCharge, BillUsage, Category, FuelFill, Household, Member, MonthTotal, PaymentMethod, Recurring, RecurringInput,
  Scope, Spouse, Transaction, TxFuel, TxInput, UtilityBill,
} from './types'

const TX_COLUMNS =
  'id, household_id, type, occurred_on, amount, title, memo, category_id, payment_method_id, scope, source, created_by, created_at, recurring_id, recurring_month, platform'
const ITEM_COLUMNS = 'id, name, quantity, unit_price, amount, pack_size, pack_unit, image_path, sort'
// 주유 기록(fuel_fills)은 내역 하나에 하나라 함께 읽는다
const TX_WITH_ITEMS = `${TX_COLUMNS}, transaction_items(${ITEM_COLUMNS}), fuel_fills(liters, price_per_liter, fuel_type)`
// 품목 줄이 있는 내역만 (장보기 비교용 과거 기록)
const TX_WITH_ITEMS_ONLY = `${TX_COLUMNS}, transaction_items!inner(${ITEM_COLUMNS}), fuel_fills(liters, price_per_liter, fuel_type)`

type Num = number | string
type FuelRow = { liters: Num; price_per_liter: Num; fuel_type: string | null }
type TxRowWithItems = Omit<Transaction, 'items' | 'fuel'> & {
  transaction_items?: {
    id: string; name: string; quantity: Num; unit_price: Num | null; amount: Num
    pack_size: Num | null; pack_unit: string | null; image_path: string | null; sort: number
  }[]
  /** PostgREST는 1:1 임베드를 객체 또는 한 줄짜리 배열로 준다 */
  fuel_fills?: FuelRow | FuelRow[] | null
}

const numOrNull = (v: Num | null) => (v === null ? null : Number(v))

function fuelOf(raw: TxRowWithItems['fuel_fills']): TxFuel | null {
  const f = Array.isArray(raw) ? raw[0] : raw
  if (!f) return null
  return { liters: Number(f.liters), price_per_liter: Number(f.price_per_liter), fuel_type: f.fuel_type ?? null }
}

function withItems(r: TxRowWithItems): Transaction {
  const { transaction_items: raw, fuel_fills: fuelRaw, ...t } = r
  const items = (raw ?? []).map((i) => ({
    ...i, quantity: Number(i.quantity), unit_price: numOrNull(i.unit_price), amount: Number(i.amount), pack_size: numOrNull(i.pack_size),
  })).sort((a, b) => a.sort - b.sort)
  return { ...t, amount: Number(t.amount), items, fuel: fuelOf(fuelRaw) }
}

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export async function fetchHouseholdBundle(): Promise<{
  household: Household | null
  members: Member[]
  methods: PaymentMethod[]
  categories: Category[]
  anniversaries: Anniversary[]
}> {
  const households = check(await sb().from('households').select('id, name, invite_code').limit(1))
  const household = households[0] ?? null
  if (!household) return { household: null, members: [], methods: [], categories: [], anniversaries: [] }
  const [members, methods, categories, anniversaries] = await Promise.all([
    sb().from('members').select('household_id, user_id, display_name, role, spouse_role').order('role'), // owner, partner 순
    sb().from('payment_methods').select('*').order('sort').order('name'),
    sb().from('categories').select('*').order('type').order('sort'),
    sb().from('anniversaries').select(ANNIV_COLUMNS).order('month').order('day'),
  ])
  return { household, members: check(members), methods: check(methods), categories: check(categories), anniversaries: check(anniversaries) }
}

const ANNIV_COLUMNS = 'id, household_id, name, kind, lunar, month, day'

export async function insertAnniversary(householdId: string, a: AnniversaryInput): Promise<void> {
  check(await sb().from('anniversaries').insert({ ...a, household_id: householdId }))
}

export async function updateAnniversary(id: string, a: AnniversaryInput): Promise<void> {
  check(await sb().from('anniversaries').update(a).eq('id', id))
}

export async function deleteAnniversary(id: string): Promise<void> {
  check(await sb().from('anniversaries').delete().eq('id', id))
}

/** from~to(포함) 사이의 일정. 시간은 HH:MM으로 줄인다 */
export async function fetchEvents(householdId: string, from: string, to: string): Promise<CalEvent[]> {
  const rows = check(await sb().from('events').select('id, household_id, date, time, title, memo')
    .eq('household_id', householdId).gte('date', from).lte('date', to).order('date').order('time', { nullsFirst: true })) as CalEvent[]
  return rows.map((e) => ({ ...e, time: e.time ? e.time.slice(0, 5) : null }))
}

export async function insertEvent(householdId: string, e: EventInput): Promise<void> {
  check(await sb().from('events').insert({ ...e, household_id: householdId }))
}

export async function updateEvent(id: string, e: EventInput): Promise<void> {
  check(await sb().from('events').update(e).eq('id', id))
}

export async function deleteEvent(id: string): Promise<void> {
  check(await sb().from('events').delete().eq('id', id))
}

/** 보고 있는 달과 그 전달의 내역 (전월 비교용) */
export async function fetchTwoMonths(householdId: string, ym: string): Promise<Transaction[]> {
  const start = monthRange(addMonths(ym, -1)).start
  const end = monthRange(ym).end
  const rows = check(
    await sb()
      .from('transactions')
      .select(TX_WITH_ITEMS)
      .eq('household_id', householdId)
      .gte('occurred_on', start)
      .lte('occurred_on', end)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false }),
  ) as unknown as TxRowWithItems[]
  return rows.map(withItems)
}

/** prefix: 할부 회차처럼 앱이 앞에 붙이는 메모. 사용자가 적은 메모(input.memo)는 그 뒤에 잇는다 */
export async function insertTransaction(householdId: string, input: TxInput, prefix: string | null = null): Promise<void> {
  const memo = [prefix, input.memo].filter(Boolean).join(', ') || null
  check(await sb().from('transactions').insert({ ...input, memo, household_id: householdId, source: 'manual' }))
}

/** 할부를 달마다 나눠 넣을 수 있는지 (한 회차가 1원 이상) */
export const canSplitInstallment = (total: number, months: number) => months >= 2 && total >= months

/**
 * 할부를 달마다 나눌 때: 남은 회차(다음 달 ~ 마지막 달)를 반복 항목(할부)으로 등록하고
 * 첫 회차 금액·메모와 등록한 항목 id를 돌려준다. 첫 회차 내역은 부르는 쪽이 넣는다.
 */
export async function createInstallment(householdId: string, p: {
  title: string; total: number; months: number; date: string
  category_id: string | null; payment_method_id: string | null; scope: Scope
}): Promise<{ recurringId: string; first: number; memo: string }> {
  const { first, rest } = installmentPlan(p.total, p.months)
  const total = p.total.toLocaleString('ko-KR')
  const ym = p.date.slice(0, 7)
  const row = check(await sb().from('recurring').insert({
    household_id: householdId, kind: 'installment', type: 'expense', title: p.title, amount: rest,
    day_of_month: Number(p.date.slice(8, 10)), every_months: 1, category_id: p.category_id, payment_method_id: p.payment_method_id,
    scope: p.scope, start_month: `${addMonths(ym, 1)}-01`, end_month: `${addMonths(ym, p.months - 1)}-01`, installment_months: p.months,
    active: true, memo: `총 ${total}원, ${p.months}개월 할부`,
  }).select('id').single()) as { id: string }
  return { recurringId: row.id, first, memo: `할부 1/${p.months}회, 총 ${total}원` }
}

/**
 * 직접 입력한 할부 지출. split이면 첫 회차만 이 날짜의 내역으로 넣고 남은 회차는 고정 탭의 할부로,
 * 아니면 결제 금액 전체를 넣고 메모에 할부 개월을 적는다. 나눠 넣었으면 true.
 */
export async function insertInstallmentPurchase(householdId: string, input: TxInput, months: number, split: boolean): Promise<boolean> {
  if (!split || !canSplitInstallment(input.amount, months)) {
    await insertTransaction(householdId, input, `${months}개월 할부`)
    return false
  }
  const plan = await createInstallment(householdId, { ...input, total: input.amount, months, date: input.occurred_on })
  try {
    await insertTransaction(householdId, { ...input, amount: plan.first }, plan.memo)
  } catch (e) {
    // 첫 회차를 못 넣었으면 할부 항목도 지워 둘이 어긋나지 않게 한다
    await sb().from('recurring').delete().eq('id', plan.recurringId)
    throw e
  }
  return true
}

export async function updateTransaction(id: string, input: TxInput): Promise<void> {
  check(await sb().from('transactions').update(input).eq('id', id))
}

export async function deleteTransaction(id: string): Promise<void> {
  // 품목 사진도 함께 지운다 (사진 삭제가 실패해도 내역은 지운다)
  const items = check(await sb().from('transaction_items').select('image_path').eq('transaction_id', id))
  check(await sb().from('transactions').delete().eq('id', id))
  const paths = items.map((i) => i.image_path).filter((p): p is string => Boolean(p))
  await removeItemImages(paths).catch(() => undefined)
}

const DELETE_CHUNK = 100

/**
 * 여러 내역을 한 번에 지운다(D-027). 주소가 너무 길어지지 않게 100건씩 나눠 지우고, 실제로 지운 수를 돌려준다
 * (안 보이는 내역은 RLS가 걸러 덜 지워질 수 있다). 품목 사진은 지운 내역 것만 뒤에 지운다.
 * 중간에 실패하면 그때까지 지운 수를 문장에 넣어 던진다.
 */
export async function deleteTransactions(ids: string[]): Promise<number> {
  let deleted = 0
  try {
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK)
      const items = check(await sb().from('transaction_items').select('transaction_id, image_path').in('transaction_id', chunk)) as
        { transaction_id: string; image_path: string | null }[]
      const gone = new Set((check(await sb().from('transactions').delete().in('id', chunk).select('id')) as { id: string }[]).map((r) => r.id))
      deleted += gone.size
      const paths = items.filter((x) => gone.has(x.transaction_id)).map((x) => x.image_path).filter((p): p is string => Boolean(p))
      await removeItemImages(paths).catch(() => undefined)
    }
  } catch (e) {
    throw new Error(deleted ? `${deleted}건 지운 뒤 멈췄어요. ${friendlyError(e)}` : friendlyError(e), { cause: e })
  }
  return deleted
}

/** 같은 영수증에서 나눠 저장한 내역 한 줄 */
export type BatchMate = Pick<Transaction, 'id' | 'occurred_on' | 'title' | 'amount'>

/**
 * 이 내역과 같은 영수증에서 나눠 저장한 내역들(D-027, 이 내역 포함, 저장한 순서).
 * 묶음이 없거나 읽지 못하면(save_batch 칸을 만들기 전 포함) 빈 목록이다. 월 내역 읽기에는 이 칸을 넣지 않는다.
 */
export async function fetchSaveBatch(tx: Pick<Transaction, 'id' | 'household_id'>): Promise<BatchMate[]> {
  const own = await sb().from('transactions').select('save_batch').eq('id', tx.id).maybeSingle()
  const batch = (own.data as { save_batch?: string | null } | null)?.save_batch
  if (own.error || !batch) return []
  const { data, error } = await sb().from('transactions').select('id, occurred_on, title, amount')
    .eq('household_id', tx.household_id).eq('save_batch', batch).order('created_at').order('id')
  if (error || !data) return []
  return (data as BatchMate[]).map((r) => ({ ...r, amount: Number(r.amount) }))
}

export async function createHousehold(displayName: string, role: Spouse): Promise<void> {
  check(await sb().rpc('create_household', { p_display_name: displayName, p_spouse_role: role }))
}

export async function updateSpouseRole(householdId: string, userId: string, role: Spouse): Promise<void> {
  check(
    await sb().from('members').update({ spouse_role: role }).eq('household_id', householdId).eq('user_id', userId),
  )
}

export async function joinHousehold(code: string, displayName: string): Promise<void> {
  check(await sb().rpc('join_household', { p_code: code, p_display_name: displayName }))
}

export async function updateDisplayName(householdId: string, userId: string, name: string): Promise<void> {
  check(
    await sb().from('members').update({ display_name: name }).eq('household_id', householdId).eq('user_id', userId),
  )
}

export async function insertCategory(householdId: string, c: Pick<Category, 'type' | 'name' | 'sort'>): Promise<void> {
  check(await sb().from('categories').insert({ ...c, household_id: householdId }))
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<void> {
  check(await sb().from('categories').update({ archived }).eq('id', id))
}

/** 기간 내역 (통계·내보내기·구독 찾기) */
export async function fetchRange(householdId: string, from: string, to: string): Promise<Transaction[]> {
  const rows = check(
    await sb().from('transactions').select(TX_COLUMNS).eq('household_id', householdId)
      .gte('occurred_on', from).lte('occurred_on', to)
      .order('occurred_on', { ascending: true }).order('created_at', { ascending: true }),
  )
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

export async function fetchMonthlyTotals(householdId: string, from: string, to: string): Promise<MonthTotal[]> {
  const rows = check(await sb().rpc('monthly_totals', { p_household_id: householdId, p_from: from, p_to: to })) as
    { month: string; type: MonthTotal['type']; total: number | string; n: number }[]
  return rows.map((r) => ({ ...r, total: Number(r.total) }))
}

const RECURRING_COLUMNS =
  'id, household_id, kind, type, title, amount, day_of_month, every_months, category_id, payment_method_id, scope, start_month, end_month, active, memo, installment_months'

export async function fetchRecurring(householdId: string): Promise<Recurring[]> {
  const rows = check(await sb().from('recurring').select(RECURRING_COLUMNS).eq('household_id', householdId)
    .order('kind').order('day_of_month').order('title'))
  return rows.map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount) })) as Recurring[]
}

export async function insertRecurring(householdId: string, r: RecurringInput): Promise<void> {
  check(await sb().from('recurring').insert({ ...r, household_id: householdId }))
}

export async function updateRecurring(id: string, r: RecurringInput): Promise<void> {
  check(await sb().from('recurring').update(r).eq('id', id))
}

export async function deleteRecurring(id: string): Promise<void> {
  check(await sb().from('recurring').delete().eq('id', id))
}

/** 날짜가 지난 반복 내역을 넣고, 새로 넣은 건수를 돌려준다 */
export async function generateRecurring(householdId: string, today: string): Promise<number> {
  return Number(check(await sb().rpc('generate_recurring', { p_household_id: householdId, p_today: today })))
}

/** 금액을 매달 직접 넣는 반복 내역(관리비 등)의 이번 달 분 */
export async function recordRecurring(householdId: string, r: Recurring, month: string, occurredOn: string, amount: number): Promise<void> {
  check(await sb().from('transactions').insert({
    household_id: householdId, type: r.type, occurred_on: occurredOn, amount, title: r.title,
    category_id: r.category_id, payment_method_id: r.payment_method_id, scope: r.scope, source: 'recurring',
    recurring_id: r.id, recurring_month: month,
  }))
}

const BILL_COLUMNS = 'id, household_id, bill_month, total, due_date, charges, usages, transaction_id'

/** 관리비 고지서 (최근 3년, 최신 달부터) */
export async function fetchBills(householdId: string): Promise<UtilityBill[]> {
  const rows = check(await sb().from('utility_bills').select(BILL_COLUMNS).eq('household_id', householdId)
    .order('bill_month', { ascending: false }).limit(36)) as (Omit<UtilityBill, 'total'> & { total: number | string })[]
  return rows.map((r) => ({ ...r, total: Number(r.total) }))
}

export interface BillInput {
  bill_month: string // YYYY-MM-01
  total: number
  due_date: string | null
  charges: BillCharge[]
  usages: BillUsage[]
}

export interface BillExpense {
  occurred_on: string
  title: string
  category_id: string | null
  scope: Transaction['scope']
  /** 금액을 매달 넣는 관리비 반복 항목이 있으면 그 달 분으로 연결한다 (입력할 차례 알림이 꺼진다) */
  recurring: Recurring | null
}

/**
 * 고지서를 저장하고, expense가 있으면 가계부 지출도 넣는다.
 * 같은 달 고지서를 다시 넣으면 고지서와 연결된 지출을 고친다(두 번 들어가지 않게).
 */
export async function saveUtilityBill(householdId: string, bill: BillInput, expense: BillExpense | null): Promise<void> {
  const existing = check(await sb().from('utility_bills').select('id, transaction_id')
    .eq('household_id', householdId).eq('bill_month', bill.bill_month).maybeSingle()) as { id: string; transaction_id: string | null } | null
  let txId = existing?.transaction_id ?? null
  // 관리비 항목이 아직 없으면 만든다. 그래야 고정 탭의 관리비·공과금에 보이고, 다음 달부터 입력할 차례를 알려 준다
  const link = expense ? { id: expense.recurring?.id ?? await createUtilityItem(householdId, expense), created: !expense.recurring } : null
  try {
    if (expense && link) {
      const month = `${expense.occurred_on.slice(0, 7)}-01`
      const fields = {
        type: 'expense' as const, occurred_on: expense.occurred_on, amount: bill.total, title: expense.title,
        category_id: expense.category_id, scope: expense.scope,
        memo: `관리비 고지서 ${Number(bill.bill_month.slice(5, 7))}월분`,
        recurring_id: link.id, recurring_month: month,
      }
      if (!txId) {
        // 이번 달 관리비를 이미 직접 넣었으면 그 내역을 쓴다
        const same = check(await sb().from('transactions').select('id').eq('recurring_id', link.id).eq('recurring_month', month).maybeSingle()) as { id: string } | null
        txId = same?.id ?? null
      }
      if (txId) {
        check(await sb().from('transactions').update(fields).eq('id', txId))
      } else {
        const row = check(await sb().from('transactions')
          .insert({ ...fields, household_id: householdId, source: 'photo' }).select('id').single()) as { id: string }
        txId = row.id
      }
    }
    check(await sb().from('utility_bills').upsert({
      household_id: householdId, ...bill, transaction_id: txId,
    }, { onConflict: 'household_id,bill_month' }))
  } catch (e) {
    // 지출·고지서를 못 넣었으면 방금 만든 항목도 지워 둘이 어긋나지 않게 한다
    if (link?.created) await sb().from('recurring').delete().eq('id', link.id)
    throw e
  }
}

/** 고지서 지출을 연결할 관리비 항목(금액을 매달 넣는 관리비·공과금)을 만들고 id를 돌려준다 */
async function createUtilityItem(householdId: string, expense: BillExpense): Promise<string> {
  const row = check(await sb().from('recurring').insert({ ...utilityItemForBill(expense), household_id: householdId })
    .select('id').single()) as { id: string }
  return row.id
}

const FUEL_COLUMNS = 'id, transaction_id, liters, price_per_liter, fuel_type, transactions(occurred_on, amount, title)'
const FUEL_LIMIT = 200

/** 주유 기록(최근 날짜 먼저, 200건). 날짜·금액·가게 이름은 내역에서 읽는다 */
export async function fetchFuelFills(householdId: string): Promise<FuelFill[]> {
  type Row = { id: string; transaction_id: string; liters: Num; price_per_liter: Num; fuel_type: string | null
    transactions: { occurred_on: string; amount: Num; title: string } | { occurred_on: string; amount: Num; title: string }[] | null }
  const rows = check(await sb().from('fuel_fills').select(FUEL_COLUMNS).eq('household_id', householdId)
    .order('created_at', { ascending: false }).limit(FUEL_LIMIT)) as unknown as Row[]
  return rows.flatMap((r) => {
    const t = Array.isArray(r.transactions) ? r.transactions[0] : r.transactions
    if (!t) return []
    return [{ id: r.id, transaction_id: r.transaction_id, liters: Number(r.liters), price_per_liter: Number(r.price_per_liter), fuel_type: r.fuel_type ?? null,
      occurred_on: t.occurred_on, amount: Number(t.amount), title: t.title }]
  }).sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0))
}

/** 내역에 주유 기록을 붙인다 (영수증에 적힌 리터·단가만) */
export async function insertFuelFill(householdId: string, transactionId: string, f: TxFuel): Promise<void> {
  check(await sb().from('fuel_fills').insert({ household_id: householdId, transaction_id: transactionId, liters: f.liters, price_per_liter: f.price_per_liter, fuel_type: f.fuel_type }))
}

const HISTORY_LIMIT = 1000

/** 품목 줄이 있는 지출 내역(장보기 비교용 과거 기록). from 이후, 최근 날짜부터 1,000건 */
export async function fetchItemHistory(householdId: string, from: string): Promise<Transaction[]> {
  const rows = check(
    await sb().from('transactions').select(TX_WITH_ITEMS_ONLY).eq('household_id', householdId).eq('type', 'expense')
      .gte('occurred_on', from).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
  ) as unknown as TxRowWithItems[]
  return rows.map(withItems)
}

/** 구글 시트 연동 주소의 토큰. rotate면 새로 만들고 이전 주소는 끊긴다 */
export async function exportToken(householdId: string, rotate = false): Promise<string> {
  return String(check(await sb().rpc('export_token', { p_household_id: householdId, p_rotate: rotate })))
}

/** 서버 오류 메시지를 사용자 문장으로 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('invalid_code')) return '초대 코드가 맞지 않아요. 다시 확인해 주세요.'
  if (msg.includes('household_full')) return '이 가계부에는 이미 두 사람이 있어요.'
  if (msg.includes('already_in_household')) return '이미 가계부에 참여하고 있어요.'
  if (msg.includes('duplicate key') && msg.includes('categories')) return '같은 이름의 분류가 이미 있어요.'
  if (msg.includes('members_household_spouse_role_key')) return '배우자가 이미 그 역할로 등록돼 있어요.'
  if (msg.includes('transactions_recurring_month_key')) return '이번 달 분은 이미 들어가 있어요.'
  if (msg.includes('transactions_scope_check') || msg.includes('recurring_scope_check')) return "'자녀'는 DB 설정을 마친 뒤에 쓸 수 있어요. 잠시 다른 항목을 골라 주세요."
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '인터넷 연결을 확인해 주세요.'
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요.'
  if (lower.includes('email not confirmed')) return '메일함에서 가입 확인 링크를 먼저 눌러 주세요.'
  if (lower.includes('already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요.'
  // 새 가입은 Auth 설정(signup_disabled)과 DB 트리거(signups_closed) 두 곳에서 막는다
  if (lower.includes('signups not allowed') || lower.includes('database error saving new user') || msg.includes('signups_closed')) {
    return '지금은 새 가입을 받지 않아요. 가입한 계정으로 로그인해 주세요.'
  }
  if (lower.includes('password should')) return '비밀번호가 너무 짧거나 쉬워요. 더 길게 정해 주세요.'
  if (lower.includes('rate limit')) return '메일을 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.'
  if (lower.includes('expired')) return '링크가 만료됐어요. 다시 요청해 주세요.'
  return `문제가 생겼어요: ${msg}`
}
