import { useState } from 'react'
import { createHousehold, friendlyError, joinHousehold } from '../lib/api'
import { SCOPE_LABEL } from '../lib/lookup'
import { sb } from '../lib/supabase'
import type { Spouse } from '../lib/types'

export function Onboarding({ onDone }: { onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [role, setRole] = useState<Spouse | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (mode === 'create' && !role) return setErr('남편인지 아내인지 골라 주세요.')
    if (mode === 'join' && code.replace(/[^A-Za-z0-9]/g, '').length !== 8) return setErr('초대 코드 8자리를 입력하세요.')
    setBusy(true); setErr('')
    try {
      if (mode === 'create') await createHousehold(SCOPE_LABEL[role!], role!)
      else await joinHousehold(code, '배우자') // 역할은 만든 사람의 반대로 자동 지정
      await onDone()
    } catch (e) {
      setErr(friendlyError(e)); setBusy(false)
    }
  }

  return (
    <div className="app wrap center">
      <div>
        <p className="brand">시작하기</p>
        <p className="lead">한 사람이 가계부를 만들고, 배우자는 초대 코드로 참여합니다.</p>
      </div>
      <div className="seg" role="group">
        <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>새 가계부 만들기</button>
        <button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>초대 코드로 참여</button>
      </div>
      <form className="view" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {mode === 'create' ? (
          <div className="field">
            <span className="lbl">나는</span>
            <div className="seg" role="group">
              {(['husband', 'wife'] as Spouse[]).map((r) => (
                <button type="button" key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{SCOPE_LABEL[r]}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="code">초대 코드 (배우자의 설정 화면에 있어요)</label>
            <input id="code" className="input code" autoCapitalize="characters" autoComplete="off" maxLength={9} placeholder="ABCD-2345"
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </div>
        )}
        <p className="err" role="alert">{err}</p>
        <button className="primary" disabled={busy}>{busy ? '처리 중…' : mode === 'create' ? '만들기' : '참여하기'}</button>
      </form>
      <button className="link-btn" onClick={() => void sb().auth.signOut()}>다른 이메일로 로그인</button>
    </div>
  )
}
