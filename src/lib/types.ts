export type TxType = 'expense' | 'income'
export type Spouse = 'husband' | 'wife'
/** 누구를 위한 지출(수입)인가 */
export type Scope = 'shared' | Spouse | 'child'
/** 결제수단의 주인: 남편·아내·공동 돈, 또는 입력한 사람의 돈(현금) */
export type MethodOwner = Spouse | 'shared' | 'entered_by'
export type MethodKind = 'card' | 'account' | 'cash' | 'easypay'
export type TxSource = 'manual' | 'text' | 'photo' | 'recurring'

export interface Household {
  id: string
  name: string
  invite_code: string
  share_ratio: number
}

export interface Member {
  household_id: string
  user_id: string
  display_name: string
  role: 'owner' | 'partner'
  spouse_role: Spouse | null
}

export interface PaymentMethod {
  id: string
  household_id: string
  name: string
  kind: MethodKind
  last4: string | null
  owner: MethodOwner
  sort: number
  archived: boolean
}

export interface Category {
  id: string
  household_id: string
  type: TxType
  name: string
  sort: number
  archived: boolean
}

export interface Transaction {
  id: string
  household_id: string
  type: TxType
  occurred_on: string // YYYY-MM-DD
  amount: number
  title: string
  memo: string | null
  category_id: string | null
  payment_method_id: string | null
  scope: Scope
  source: TxSource
  created_by: string
  created_at: string
  recurring_id: string | null
  /** 품목 (영수증·쇼핑 주문). 목록 화면에서 불러온 경우에만 있음 */
  items?: TxItem[]
}

export interface TxItem {
  id: string
  name: string
  quantity: number
  amount: number
  image_path: string | null
  sort: number
}

export type TxInput = Pick<
  Transaction,
  'type' | 'occurred_on' | 'amount' | 'title' | 'category_id' | 'payment_method_id' | 'scope'
>

export type RecurringKind = 'fixed' | 'subscription' | 'utility'

export interface Recurring {
  id: string
  household_id: string
  kind: RecurringKind
  type: TxType
  title: string
  /** null: 매달 금액이 달라 직접 입력(관리비 등) */
  amount: number | null
  day_of_month: number
  every_months: 1 | 12
  category_id: string | null
  payment_method_id: string | null
  scope: Scope
  start_month: string // YYYY-MM-01
  end_month: string | null
  active: boolean
  memo: string | null
}

export type RecurringInput = Omit<Recurring, 'id' | 'household_id'>

export interface MonthTotal {
  month: string // YYYY-MM-01
  type: TxType
  total: number
  n: number
}
