import { useState } from 'react'
import { friendlyError } from '../lib/api'
import { sb } from '../lib/supabase'

type Mode = 'login' | 'signup' | 'reset'

export function Login() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')

  function switchMode(m: Mode) {
    setMode(m); setErr(''); setInfo('')
  }

  async function submit() {
    const mail = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setErr('이메일 주소를 확인해 주세요.')
    if (mode !== 'reset' && password.length < 8) return setErr('비밀번호는 8자 이상으로 입력하세요.')
    setBusy(true); setErr(''); setInfo('')
    try {
      if (mode === 'login') {
        const { error } = await sb().auth.signInWithPassword({ email: mail, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await sb().auth.signUp({
          email: mail, password, options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) {
          setInfo('확인 메일을 보냈어요. 메일의 링크를 누른 뒤, 여기로 돌아와 로그인하세요.')
          setMode('login')
        }
      } else {
        const { error } = await sb().auth.resetPasswordForEmail(mail, { redirectTo: window.location.origin })
        if (error) throw error
        setInfo('비밀번호 재설정 메일을 보냈어요. 메일의 링크를 누르면 새 비밀번호를 정할 수 있어요.')
      }
    } catch (e) {
      setErr(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const label = mode === 'login' ? '로그인' : mode === 'signup' ? '가입하기' : '재설정 메일 받기'

  return (
    <div className="app wrap center">
      <div>
        <p className="brand">우리집 가계부</p>
        <p className="lead">둘이 같이 쓰는 가계부</p>
      </div>
      {mode !== 'reset' && (
        <div className="seg" role="group">
          <button aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>로그인</button>
          <button aria-pressed={mode === 'signup'} onClick={() => switchMode('signup')}>처음 가입</button>
        </div>
      )}
      <form className="view" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== 'reset' && (
          <div className="field">
            <label htmlFor="password">비밀번호 (8자 이상)</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </div>
        )}
        {info && <p className="note" role="status">{info}</p>}
        <p className="err" role="alert">{err}</p>
        <button className="primary" disabled={busy}>{busy ? '처리 중…' : label}</button>
      </form>
      {mode === 'login' && <button className="link-btn" onClick={() => switchMode('reset')}>비밀번호를 잊었어요</button>}
      {mode === 'reset' && <button className="link-btn" onClick={() => switchMode('login')}>로그인으로 돌아가기</button>}
      <p className="note">한 번 로그인하면 이 기기에서는 로그인 상태가 유지됩니다.</p>
    </div>
  )
}

/** 재설정 메일의 링크로 들어왔을 때 새 비밀번호를 정한다 */
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (password.length < 8) return setErr('비밀번호는 8자 이상으로 입력하세요.')
    setBusy(true); setErr('')
    const { error } = await sb().auth.updateUser({ password })
    setBusy(false)
    if (error) return setErr(friendlyError(error))
    onDone()
  }

  return (
    <div className="app wrap center">
      <p className="brand">새 비밀번호</p>
      <form className="view" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="field">
          <label htmlFor="new-password">새 비밀번호 (8자 이상)</label>
          <input id="new-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <p className="err" role="alert">{err}</p>
        <button className="primary" disabled={busy}>{busy ? '저장 중…' : '비밀번호 바꾸기'}</button>
      </form>
    </div>
  )
}
