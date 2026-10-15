import { addMonths, monthRange } from './dates'
import { sb } from './supabase'
import type { Category, Household, Member, PaymentMethod, Transaction, TxInput } from './types'

const TX_COLUMNS =
  'id, household_id, type, occurred_on, amount, title, memo, category_id, payment_method_id, scope, scope_user_id, source, created_by, created_at'

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
    sb().from('members').select('household_id, user_id, display_name, role').order('role'), // owner, partner 순
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

export async function createHousehold(displayName: string): Promise<void> {
  check(await sb().rpc('create_household', { p_display_name: displayName }))
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
  m: Pick<PaymentMethod, 'name' | 'kind' | 'last4' | 'owner_type' | 'owner_user_id' | 'sort'>,
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

/** 서버 오류 메시지를 사용자 문장으로 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('invalid_code')) return '초대 코드가 맞지 않아요. 다시 확인해 주세요.'
  if (msg.includes('household_full')) return '이 가계부에는 이미 두 사람이 있어요.'
  if (msg.includes('already_in_household')) return '이미 가계부에 참여하고 있어요.'
  if (msg.includes('duplicate key') && msg.includes('categories')) return '같은 이름의 분류가 이미 있어요.'
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
