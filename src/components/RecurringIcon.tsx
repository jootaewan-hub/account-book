import type { ReactElement } from 'react'
import { recurringIconKey, type RecurringIconKey } from '../lib/recurringIcon'
import { BankIcon, BookOpenIcon, CarIcon, CoinsIcon, CreditCardIcon, DeviceMobileIcon, HeartbeatIcon, HouseIcon, LightningIcon, PushPinIcon, ReceiptIcon, ShieldCheckIcon } from './Icons'
import type { RecurringKind, TxType } from '../lib/types'

// 아이콘은 앱 공통 Phosphor 한 가족(D-048). 이모지는 쓰지 않는다
const ICONS: Record<Exclude<RecurringIconKey, 'subscription'>, ReactElement> = {
  tax: <ReceiptIcon />, insurance: <ShieldCheckIcon />, home: <HouseIcon />, loan: <BankIcon />,
  phone: <DeviceMobileIcon />, education: <BookOpenIcon />, utility: <LightningIcon />, installment: <CreditCardIcon />,
  income: <CoinsIcon />, car: <CarIcon />, health: <HeartbeatIcon />, fixed: <PushPinIcon />,
}

/** 고정 탭 줄의 분류 아이콘 타일(구독이 아닌 항목). 구독은 ServiceLogo를 쓴다 */
export function RecurringIcon({ kind, title, type, size = 34 }: { kind: RecurringKind; title: string; type: TxType; size?: number }) {
  const key = recurringIconKey({ kind, title, type })
  return (
    <span className="svc-logo rc-icon" style={{ width: size, height: size, borderRadius: Math.round(size * 0.24) }} aria-hidden="true">
      {ICONS[key === 'subscription' ? 'fixed' : key]}
    </span>
  )
}
