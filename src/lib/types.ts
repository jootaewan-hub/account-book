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
  /** 반복 항목의 몇 월분인지 (YYYY-MM-01). 내역 날짜와 다를 수 있다 */
  recurring_month?: string | null
  /** 산 곳: 쿠팡·네이버 같은 온라인 플랫폼. 매장 결제는 null */
  platform: string | null
  /** 품목 (영수증·쇼핑 주문). 목록 화면에서 불러온 경우에만 있음 */
  items?: TxItem[]
  /** 주유 기록(주유소 영수증). 목록 화면에서 불러온 경우에만 있고, 주유 내역이 아니면 null */
  fuel?: TxFuel | null
}

/** 내역에 붙은 주유 값(영수증에 적힌 값 그대로) */
export interface TxFuel {
  liters: number
  price_per_liter: number
  fuel_type: string | null
}

/** 주유 기록 한 줄: public.fuel_fills에 내역의 날짜·금액·가게 이름을 붙인 것 */
export interface FuelFill extends TxFuel {
  id: string
  transaction_id: string
  occurred_on: string
  amount: number
  title: string
}

export interface TxItem {
  id: string
  name: string
  quantity: number
  /** 1개 가격 */
  unit_price: number | null
  amount: number
  /** 상품 1개에 든 총량과 단위 (단위당 가격 계산용) */
  pack_size: number | null
  pack_unit: string | null
  image_path: string | null
  sort: number
}

export type TxInput = Pick<
  Transaction,
  'type' | 'occurred_on' | 'amount' | 'title' | 'category_id' | 'payment_method_id' | 'scope' | 'platform' | 'memo'
>

export type RecurringKind = 'fixed' | 'subscription' | 'utility' | 'installment'

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
  /** 할부(kind 'installment')의 총 개월 수. end_month가 마지막 회차의 달 */
  installment_months: number | null
}

export type RecurringInput = Omit<Recurring, 'id' | 'household_id'>

export interface MonthTotal {
  month: string // YYYY-MM-01
  type: TxType
  total: number
  n: number
}

/** 관리비 고지서 항목 (원). prev_month·last_year는 고지서에 적혀 있던 값 */
export interface BillCharge {
  name: string
  amount: number
  prev_month: number | null
  last_year: number | null
}

/** 관리비 고지서의 세대 사용량 (전기·수도·온수·난방·가스) */
export interface BillUsage {
  name: string
  amount: number
  unit: string | null
  prev_month: number | null
  last_year: number | null
}

export interface UtilityBill {
  id: string
  household_id: string
  /** 몇 월분인지 (YYYY-MM-01) */
  bill_month: string
  total: number
  due_date: string | null
  charges: BillCharge[]
  usages: BillUsage[]
  transaction_id: string | null
}

/** 기념일 종류: 생일, 우리 둘(만난 날·결혼기념일 등), 추모, 그 밖 */
export type AnnivKind = 'birthday' | 'couple' | 'memorial' | 'other'

export interface Anniversary {
  id: string
  household_id: string
  name: string
  kind: AnnivKind
  /** true면 month·day가 음력 (윤달이 아닌 달) */
  lunar: boolean
  month: number
  day: number
}

export type AnniversaryInput = Pick<Anniversary, 'name' | 'kind' | 'lunar' | 'month' | 'day'>

/** 일정: 한 번 있는 일 (병원 예약, 모임 등) */
export interface CalEvent {
  id: string
  household_id: string
  date: string // YYYY-MM-DD
  /** HH:MM, 하루 종일이면 null */
  time: string | null
  title: string
  memo: string | null
}

export type EventInput = Pick<CalEvent, 'date' | 'time' | 'title' | 'memo'>
