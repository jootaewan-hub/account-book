import { useState } from 'react'
import {
  friendlyError, insertCategory, insertMethod, setCategoryArchived, setMethodArchived, updateDisplayName, updateShareRatio,
} from '../lib/api'
import { formatInviteCode } from '../lib/format'
import type { Lookup } from '../lib/lookup'
import { sb } from '../lib/supabase'
import type { Category, Household, MethodKind, OwnerType, PaymentMethod } from '../lib/types'

interface Props {
  household: Household
  methods: PaymentMethod[]
  categories: Category[]
  lookup: Lookup
  email: string
  onChanged: () => Promise<void>
  toast: (msg: string) => void
}

const KIND_LABEL: Record<MethodKind, string> = { card: '카드', account: '계좌', cash: '현금', easypay: '간편결제' }
const RATIOS = [0.5, 0.6, 0.4, 0.7, 0.3]

export function SettingsView({ household, methods, categories, lookup, email, onChanged, toast }: Props) {
  const owner = lookup.members.find((m) => m.role === 'owner')
  const partner = lookup.members.find((m) => m.role === 'partner')
  const meMember = lookup.members.find((m) => m.user_id === lookup.me)

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); await onChanged(); toast(ok) } catch (e) { toast(friendlyError(e)) }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(household.invite_code); toast('초대 코드를 복사했어요') } catch { toast('길게 눌러 직접 복사해 주세요') }
  }

  // 내 이름
  const [name, setName] = useState(meMember?.display_name ?? '')

  // 결제수단 추가
  const [mName, setMName] = useState('')
  const [mKind, setMKind] = useState<MethodKind>('card')
  const [mLast4, setMLast4] = useState('')
  const [mOwner, setMOwner] = useState<string>(lookup.me)
  const [mErr, setMErr] = useState('')

  async function addMethod() {
    if (!mName.trim()) return setMErr('이름을 입력하세요.')
    if (mLast4 && !/^\d{4}$/.test(mLast4)) return setMErr('끝자리는 숫자 4개로 입력하세요.')
    setMErr('')
    const owner_type: OwnerType = mOwner === 'shared' ? 'shared' : mOwner === 'entered_by' ? 'entered_by' : 'member'
    await run(() => insertMethod(household.id, {
      name: mName.trim(), kind: mKind, last4: mLast4 || null, owner_type,
      owner_user_id: owner_type === 'member' ? mOwner : null, sort: methods.length + 1,
    }), '결제수단을 추가했어요')
    setMName(''); setMLast4('')
  }

  // 분류 추가
  const [cName, setCName] = useState('')
  const [cType, setCType] = useState<'expense' | 'income'>('expense')

  function ownerLabel(m: PaymentMethod) {
    if (m.owner_type === 'shared') return '공동'
    if (m.owner_type === 'entered_by') return '입력한 사람'
    return lookup.nameOf(m.owner_user_id)
  }

  return (
    <section className="view">
      <div className="card">
        <h3 className="section-title">우리 가계부</h3>
        {lookup.members.map((m) => (
          <div className="set-row" key={m.user_id}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`who ${m.role === 'owner' ? 'a' : 'b'}`}>{m.display_name}</span>
              {m.user_id === lookup.me && <span className="tag">내 계정</span>}
            </span>
            <span className="r">{m.role === 'owner' ? '만든 사람' : '참여'}</span>
          </div>
        ))}
        {!partner && (
          <p className="note">배우자에게 아래 초대 코드를 보내 주세요. 배우자가 앱에 로그인한 뒤 "초대 코드로 참여"에서 입력하면 함께 쓰게 됩니다.</p>
        )}
        <div className="set-row">
          <span>초대 코드</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="code" style={{ userSelect: 'all' }}>{formatInviteCode(household.invite_code)}</span>
            <button className="link-btn" onClick={copyCode}>복사</button>
          </span>
        </div>
        <div className="form-grid">
          <input className="input" aria-label="내 표시 이름" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          <button className="ghost" disabled={!name.trim() || name.trim() === meMember?.display_name}
            onClick={() => run(() => updateDisplayName(household.id, lookup.me, name.trim()), '이름을 바꿨어요')}>내 이름 바꾸기</button>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">결제수단 · 누가 냈는지는 여기서 정해집니다</h3>
        {methods.map((m) => (
          <div className="set-row" key={m.id} style={{ opacity: m.archived ? 0.5 : 1 }}>
            <span style={{ minWidth: 0 }}>
              {m.name}{m.last4 && <span className="num" style={{ color: 'var(--ink-3)' }}> ··{m.last4}</span>}
              <span className="r"> {KIND_LABEL[m.kind]} · {ownerLabel(m)}</span>
            </span>
            <button className="link-btn" onClick={() => run(() => setMethodArchived(m.id, !m.archived), m.archived ? '다시 보이게 했어요' : '숨겼어요')}>
              {m.archived ? '보이기' : '숨기기'}
            </button>
          </div>
        ))}
        <div className="form-grid">
          <input className="input full" aria-label="결제수단 이름" placeholder="예: 신한 체크카드" value={mName} maxLength={30} onChange={(e) => setMName(e.target.value)} />
          <select className="input" aria-label="종류" value={mKind} onChange={(e) => setMKind(e.target.value as MethodKind)}>
            {(Object.keys(KIND_LABEL) as MethodKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="input num" aria-label="카드 끝 4자리" placeholder="끝 4자리 (선택)" inputMode="numeric" maxLength={4} value={mLast4} onChange={(e) => setMLast4(e.target.value.replace(/\D/g, ''))} />
          <select className="input full" aria-label="누구 돈인지" value={mOwner} onChange={(e) => setMOwner(e.target.value)}>
            {owner && <option value={owner.user_id}>{owner.display_name}의 돈</option>}
            {partner && <option value={partner.user_id}>{partner.display_name}의 돈</option>}
            <option value="shared">공동 돈 (생활비 통장 등)</option>
            <option value="entered_by">입력한 사람의 돈 (현금 등)</option>
          </select>
          <button className="ghost full" onClick={addMethod}>결제수단 추가</button>
          <p className="err full">{mErr}</p>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">분류 · 눌러서 숨기거나 다시 보이게</h3>
        {(['expense', 'income'] as const).map((t) => (
          <div key={t} className="field" style={{ marginBottom: 10 }}>
            <span className="lbl">{t === 'expense' ? '지출' : '수입'}</span>
            <div className="chips">
              {categories.filter((c) => c.type === t).map((c) => (
                <button key={c.id} className={`chip${c.archived ? ' muted' : ''}`}
                  onClick={() => run(() => setCategoryArchived(c.id, !c.archived), c.archived ? `${c.name} 다시 보이게 했어요` : `${c.name} 숨겼어요`)}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="form-grid">
          <select className="input" aria-label="분류 구분" value={cType} onChange={(e) => setCType(e.target.value as 'expense' | 'income')}>
            <option value="expense">지출</option>
            <option value="income">수입</option>
          </select>
          <input className="input" aria-label="새 분류 이름" placeholder="새 분류" value={cName} maxLength={20} onChange={(e) => setCName(e.target.value)} />
          <button className="ghost full" disabled={!cName.trim()}
            onClick={async () => { await run(() => insertCategory(household.id, { type: cType, name: cName.trim(), sort: 100 }), '분류를 추가했어요'); setCName('') }}>
            분류 추가
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">정산</h3>
        <div className="set-row">
          <label htmlFor="ratio">공동 지출 분담 비율 ({owner?.display_name ?? '만든 사람'} : {partner?.display_name ?? '참여자'})</label>
          <select id="ratio" className="input" style={{ width: 'auto' }} value={String(household.share_ratio)}
            onChange={(e) => run(() => updateShareRatio(household.id, Number(e.target.value)), '분담 비율을 바꿨어요')}>
            {RATIOS.map((r) => <option key={r} value={String(r)}>{Math.round(r * 100)} : {Math.round((1 - r) * 100)}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">계정</h3>
        <div className="set-row"><span>로그인</span><span className="r">{email}</span></div>
        <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => void sb().auth.signOut()}>로그아웃</button>
      </div>
    </section>
  )
}
