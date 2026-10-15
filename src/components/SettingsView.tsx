import { useState } from 'react'
import { friendlyError, insertCategory, setCategoryArchived, updateDisplayName, updateSpouseRole } from '../lib/api'
import { formatInviteCode } from '../lib/format'
import { SCOPE_LABEL, type Lookup } from '../lib/lookup'
import { sb } from '../lib/supabase'
import type { Category, Household, Spouse } from '../lib/types'

interface Props {
  household: Household
  categories: Category[]
  lookup: Lookup
  email: string
  onChanged: () => Promise<void>
  toast: (msg: string) => void
}

export function SettingsView({ household, categories, lookup, email, onChanged, toast }: Props) {
  const meMember = lookup.members.find((m) => m.user_id === lookup.me)
  const partner = lookup.members.find((m) => m.user_id !== lookup.me)

  async function run(fn: () => Promise<void>, ok: string) {
    try { await fn(); await onChanged(); toast(ok) } catch (e) { toast(friendlyError(e)) }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(household.invite_code); toast('초대 코드를 복사했어요') } catch { toast('길게 눌러 직접 복사해 주세요') }
  }

  const [name, setName] = useState(meMember?.display_name ?? '')

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
        <h3 className="section-title">계정</h3>
        <div className="set-row"><span>로그인</span><span className="r">{email}</span></div>
        <button className="ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => void sb().auth.signOut()}>로그아웃</button>
      </div>
    </section>
  )
}
