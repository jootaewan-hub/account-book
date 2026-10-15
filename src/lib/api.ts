import { addMonths, monthRange } from './dates'
import { sb } from './supabase'
import type {
  Category, Household, Member, MonthTotal, PaymentMethod, Recurring, RecurringInput, SettlementRecord, Spouse, Transaction, TxInput,
} from './types'

const TX_COLUMNS =
  'id, household_id, type, occurred_on, amount, title, memo, category_id, payment_method_id, scope, source, created_by, created_at, recurring_id'

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export async function fetchHouseholdBundle(): Promise<{
  household: Household | null
  members: Member[]
  methods: PaymentMethod[]
  categories: Category[]
}> {
  const households = check(await sb().from('households').select('id, name, invite_code, share_ratio').limit(1))
  const household = households[0] ? { ...households[0], share_ratio: Number(households[0].share_ratio) } : null
  if (!household) return { household: null, members: [], methods: [], categories: [] }
  const [members, methods, categories] = await Promise.all([
    sb().from('members').select('household_id, user_id, display_name, role, spouse_role').order('role'), // owner, partner 순
    sb().from('payment_methods').select('*').order('sort').order('name'),
    sb().from('categories').select('*').order('type').order('sort'),
  ])
  return { household, members: check(members), methods: check(methods), categories: check(categories) }
}

/** 보고 있는 달과 그 전달의 내역 (전월 비교용) */
export async function fetchTwoMonths(householdId: string, ym: string): Promise<Transaction[]> {
  const start = monthRange(addMonths(ym, -1)).start
  const end = monthRange(ym).end
  const rows = check(
    await sb()
      .from('transactions')
      .select(TX_COLUMNS)
      .eq('household_id', householdId)
      .gte('occurred_on', start)
      .lte('occurred_on', end)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false }),
  )
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }))
}

export async function insertTransaction(householdId: string, input: TxInput): Promise<void> {
  check(await sb().from('transactions').insert({ ...input, household_id: householdId, source: 'manual' }))
}

export async function updateTransaction(id: string, input: TxInput): Promise<void> {
  check(await sb().from('transactions').update(input).eq('id', id))
}

export async function deleteTransaction(id: string): Promise<void> {
  check(await sb().from('transactions').delete().eq('id', id))
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

export async function updateShareRatio(householdId: string, ratio: number): Promise<void> {
  check(await sb().from('households').update({ share_ratio: ratio }).eq('id', householdId))
}

export async function updateDisplayName(householdId: string, userId: string, name: string): Promise<void> {
  check(
    await sb().from('members').update({ display_name: name }).eq('household_id', householdId).eq('user_id', userId),
  )
}

export async function insertMethod(
  householdId: string,
  m: Pick<PaymentMethod, 'name' | 'kind' | 'last4' | 'owner' | 'sort'>,
): Promise<void> {
  check(await sb().from('payment_methods').insert({ ...m, household_id: householdId }))
}

export async function setMethodArchived(id: string, archived: boolean): Promise<void> {
  check(await sb().from('payment_methods').update({ archived }).eq('id', id))
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
  'id, household_id, kind, type, title, amount, day_of_month, every_months, category_id, payment_method_id, scope, start_month, end_month, active, memo'

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

export async function fetchSettlement(householdId: string, month: string): Promise<SettlementRecord | null> {
  const rows = check(await sb().from('settlements').select('month, from_role, to_role, amount, settled_at')
    .eq('household_id', householdId).eq('month', month).limit(1))
  return rows[0] ? { ...rows[0], amount: Number(rows[0].amount) } as SettlementRecord : null
}

export async function markSettled(householdId: string, s: Omit<SettlementRecord, 'settled_at'>): Promise<void> {
  check(await sb().from('settlements').insert({ ...s, household_id: householdId }))
}

export async function unmarkSettled(householdId: string, month: string): Promise<void> {
  check(await sb().from('settlements').delete().eq('household_id', householdId).eq('month', month))
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
  if (msg.includes('settlements_pkey')) return '이미 정산 완료로 표시돼 있어요.'
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '인터넷 연결을 확인해 주세요.'
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요.'
  if (lower.includes('email not confirmed')) return '메일함에서 가입 확인 링크를 먼저 눌러 주세요.'
  if (lower.includes('already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요.'
  if (lower.includes('password should')) return '비밀번호가 너무 짧거나 쉬워요. 더 길게 정해 주세요.'
  if (lower.includes('rate limit')) return '메일을 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.'
  if (lower.includes('expired')) return '링크가 만료됐어요. 다시 요청해 주세요.'
  return `문제가 생겼어요: ${msg}`
}
