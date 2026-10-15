import { useState } from 'react'
import { friendlyError } from '../lib/api'
import { sb } from '../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function send() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('이메일 주소를 확인해 주세요.')
    setBusy(true); setErr('')
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
    setBusy(false)
    if (error) return setErr(friendlyError(error))
    setStep('code')
  }

  async function verify() {
    setBusy(true); setErr('')
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setErr(friendlyError(error))
  }

  return (
    <div className="app wrap center">
      <div>
        <p className="brand">우리집 가계부</p>
        <p className="lead">둘이 같이 쓰는 가계부</p>
      </div>
      {step === 'email' ? (
        <form className="view" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={busy}>{busy ? '보내는 중…' : '로그인 코드 받기'}</button>
          <p className="note">비밀번호 없이, 이메일로 받은 숫자 코드로 로그인합니다.</p>
        </form>
      ) : (
        <form className="view" onSubmit={(e) => { e.preventDefault(); void verify() }}>
          <p className="lead">{email}로 보낸 숫자 코드를 입력하세요.</p>
          <div className="field">
            <label htmlFor="otp">코드</label>
            <input id="otp" className="input num" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={busy || code.length < 6}>{busy ? '확인 중…' : '로그인'}</button>
          <button type="button" className="ghost" onClick={() => { setStep('email'); setCode(''); setErr('') }}>이메일 다시 입력</button>
        </form>
      )}
    </div>
  )
}
