export type TxType = 'expense' | 'income'
export type Scope = 'shared' | 'member'
export type OwnerType = 'member' | 'shared' | 'entered_by'
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
}

export interface PaymentMethod {
  id: string
  household_id: string
  name: string
  kind: MethodKind
  last4: string | null
  owner_type: OwnerType
  owner_user_id: string | null
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
  scope_user_id: string | null
  source: TxSource
  created_by: string
  created_at: string
}

export type TxInput = Pick<
  Transaction,
  'type' | 'occurred_on' | 'amount' | 'title' | 'category_id' | 'payment_method_id' | 'scope' | 'scope_user_id'
>
