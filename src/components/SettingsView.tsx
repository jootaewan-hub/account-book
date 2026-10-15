import { useState } from 'react'
import {
  friendlyError, insertCategory, insertMethod, setCategoryArchived, setMethodArchived, updateDisplayName,
  updateShareRatio, updateSpouseRole,
} from '../lib/api'
import { formatInviteCode } from '../lib/format'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import { sb } from '../lib/supabase'
import type { Category, Household, MethodKind, MethodOwner, PaymentMethod, Spouse } from '../lib/types'

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
const OWNER_LABEL: Record<MethodOwner, string> = { husband: '남편', wife: '아내', shared: '공동', entered_by: '입력한 사람' }
const RATIOS = [0.5, 0.6, 0.4, 0.7, 0.3]

export function SettingsView({ household, methods, categories, lookup, email, onChanged, toast }: Props) {
  const meMember = lookup.members.find((m) => m.user_id === lookup.me)
  const partner = lookup.members.find((m) => m.user_id !== lookup.me)

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); await onChanged(); toast(ok) } catch (e) { toast(friendlyError(e)) }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(household.invite_code); toast('초대 코드를 복사했어요') } catch { toast('길게 눌러 직접 복사해 주세요') }
  }

  const [name, setName] = useState(meMember?.display_name ?? '')

  // 결제수단 추가
  const [mName, setMName] = useState('')
  const [mKind, setMKind] = useState<MethodKind>('card')
  const [mLast4, setMLast4] = useState('')
  const [mOwner, setMOwner] = useState<MethodOwner>(lookup.myRole ?? 'shared')
  const [mErr, setMErr] = useState('')

  async function addMethod() {
    if (!mName.trim()) return setMErr('이름을 입력하세요.')
    if (mLast4 && !/^\d{4}$/.test(mLast4)) return setMErr('끝자리는 숫자 4개로 입력하세요.')
    setMErr('')
    await run(() => insertMethod(household.id, {
      name: mName.trim(), kind: mKind, last4: mLast4 || null, owner: mOwner, sort: methods.length + 1,
    }), '결제수단을 추가했어요')
    setMName(''); setMLast4('')
  }

  const [cName, setCName] = useState('')
  const [cType, setCType] = useState<'expense' | 'income'>('expense')

  return (
    <section className="view">
      <div className="card">
        <h3 className="section-title">우리 가계부</h3>
        <div className="set-row">
          <span>나는</span>
          <div className="seg" role="group" style={{ width: 160 }}>
            {(['husband', 'wife'] as Spouse[]).map((r) => (
              <button key={r} aria-pressed={meMember?.spouse_role === r}
                onClick={() => run(() => updateSpouseRole(household.id, lookup.me, r), `${SCOPE_LABEL[r]}(으)로 정했어요`)}>
                {SCOPE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="set-row">
          <span>배우자</span>
          <span className="r">{partner ? `${lookup.personLabel(partner.user_id)} · 참여함` : '아직 참여 전'}</span>
        </div>
        {!partner && (
          <p className="note">배우자에게 아래 초대 코드를 보내 주세요. 배우자가 앱에 가입한 뒤 "초대 코드로 참여"에서 입력하면 함께 쓰게 됩니다.</p>
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
              <span className="r"> {KIND_LABEL[m.kind]} · {OWNER_LABEL[m.owner]}</span>
            </span>
            <button className="link-btn" onClick={() => run(() => setMethodArchived(m.id, !m.archived), m.archived ? '다시 보이게 했어요' : '숨겼어요')}>
              {m.archived ? '보이기' : '숨기기'}
            </button>
          </div>
        ))}
        <div className="form-grid">
          <input className="input full" aria-label="결제수단 이름" placeholder="예: 신한 체크, 현대 신용(아내)" value={mName} maxLength={30} onChange={(e) => setMName(e.target.value)} />
          <select className="input" aria-label="종류" value={mKind} onChange={(e) => setMKind(e.target.value as MethodKind)}>
            {(Object.keys(KIND_LABEL) as MethodKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="input num" aria-label="카드 끝 4자리" placeholder="끝 4자리 (선택)" inputMode="numeric" maxLength={4} value={mLast4} onChange={(e) => setMLast4(e.target.value.replace(/\D/g, ''))} />
          <select className="input full" aria-label="누구 돈인지" value={mOwner} onChange={(e) => setMOwner(e.target.value as MethodOwner)}>
            <option value="husband">남편의 돈</option>
            <option value="wife">아내의 돈</option>
            <option value="shared">공동 돈 (생활비 통장 등)</option>
            <option value="entered_by">입력한 사람의 돈 (현금 등)</option>
          </select>
          <button className="ghost full" onClick={addMethod}>결제수단 추가</button>
          <p className="err full">{mErr}</p>
        </div>
        <p className="note">
          카드를 여러 장 쓰면 한 장씩 따로 추가하세요. 문자·사진을 넣을 때 ① 끝 4자리(가려진 "1*3*"도 됨) ② 카드사 이름
          ③ 이름에 넣은 "체크"/"신용" 순서로 카드를 고릅니다. 그래도 하나로 정해지지 않으면 직접 고르게 하고,
          한 번 고른 카드는 가맹점별로 기억해 다음부터 자동으로 씁니다.
          이름은 "신한 체크", "현대 신용"처럼 카드사가 들어가게 지어 주세요.
        </p>
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
          <label htmlFor="ratio">공동 지출 분담 비율 (남편 : 아내)</label>
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
