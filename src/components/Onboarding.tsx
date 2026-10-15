import { useState } from 'react'
import { createHousehold, friendlyError, joinHousehold } from '../lib/api'
import { sb } from '../lib/supabase'

export function Onboarding({ onDone }: { onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!name.trim()) return setErr('표시할 이름을 입력하세요.')
    if (mode === 'join' && code.replace(/[^A-Za-z0-9]/g, '').length !== 8) return setErr('초대 코드 8자리를 입력하세요.')
    setBusy(true); setErr('')
    try {
      if (mode === 'create') await createHousehold(name.trim())
      else await joinHousehold(code, name.trim())
      await onDone()
    } catch (e) {
      setErr(friendlyError(e)); setBusy(false)
    }
  }

  return (
    <div className="app wrap center">
      <div>
        <p className="brand">시작하기</p>
        <p className="lead">한 사람이 가계부를 만들고, 다른 사람은 초대 코드로 참여합니다.</p>
      </div>
      <div className="seg" role="group">
        <button aria-pressed={mode === 'create'} onClick={() => setMode('create')}>새 가계부 만들기</button>
        <button aria-pressed={mode === 'join'} onClick={() => setMode('join')}>초대 코드로 참여</button>
      </div>
      <form className="view" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="field">
          <label htmlFor="name">가계부에 표시할 내 이름</label>
          <input id="name" className="input" maxLength={20} placeholder="예: 나, 남편, 아내" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {mode === 'join' && (
          <div className="field">
            <label htmlFor="code">초대 코드 (설정 화면에 있어요)</label>
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
