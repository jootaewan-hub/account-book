import { useEffect, useId, useState } from 'react'
import { canReceiveEventPush, disableEventPush, enableEventPush, isEventPushEnabled, type ReminderFields } from '../lib/eventReminders'
import type { Member } from '../lib/types'
import './eventReminderFields.css'

const eventTimes = [[1440, '하루 전'], [60, '1시간 전'], [30, '30분 전'], [10, '10분 전']] as const
const anniversaryTimes = [[10080, '1주 전'], [1440, '하루 전'], [60, '1시간 전']] as const

export function EventReminderFields({ value, members, userId, onChange, anniversary = false }: {
  value: ReminderFields & { time?: string | null }
  members: Member[]
  userId: string
  onChange: (patch: ReminderFields) => void
  anniversary?: boolean
}) {
  const baseId = useId()
  const options = anniversary ? anniversaryTimes : eventTimes
  const enabled = value.reminder_offset_minutes != null
  const recipient = value.reminder_recipient ?? 'both'

  return (
    <div className="reminder-fields">
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked
          ? { reminder_offset_minutes: options[0][0], reminder_recipient: userId || 'both' }
          : { reminder_offset_minutes: null, reminder_recipient: null })} />
        {anniversary ? '기념일 알림 받기' : '일정 알림 받기'}
      </label>
      {enabled && (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor={`${baseId}-recipient`}>받는 사람</label>
              <select className="input" id={`${baseId}-recipient`} value={recipient}
                onChange={(e) => onChange({ reminder_recipient: e.target.value })}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.user_id === userId ? '나' : m.display_name}</option>
                ))}
                {recipient !== 'both' && !members.some((m) => m.user_id === recipient) && (
                  <option value={recipient} disabled>가계부를 떠난 사람</option>
                )}
                <option value="both">우리 둘</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${baseId}-time`}>알림 시점</label>
              <select className="input" id={`${baseId}-time`} value={value.reminder_offset_minutes ?? options[0][0]}
                onChange={(e) => onChange({ reminder_offset_minutes: Number(e.target.value) })}>
                {options.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}
              </select>
            </div>
          </div>
          <p className="tx-meta">
            {anniversary ? '기념일은 한국 시간 오전 9시를 기준으로 알림을 보내요.' : value.time
              ? '일정이 시작하는 한국 시간을 기준으로 알림을 보내요.'
              : '하루 종일 일정은 시작일의 한국 시간 오전 9시를 기준으로 알림을 보내요.'}
            {anniversary ? ' 받는 사람이 설정의 일정 알림에서 자기 기기를 등록해야 해요.' : ' 받는 사람이 자기 기기의 알림을 켜야 해요.'}
          </p>
          {!anniversary && <EventPushDevice userId={userId} />}
        </>
      )}
    </div>
  )
}

export function EventPushDevice({ userId }: { userId: string }) {
  const supported = canReceiveEventPush()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supported || !userId) return
    let alive = true
    function refresh() {
      void isEventPushEnabled(userId).then((value) => { if (alive) setEnabled(value) }, (err: Error) => {
        if (alive) { setError(err.message); setEnabled(false) }
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { alive = false; window.removeEventListener('focus', refresh) }
  }, [supported, userId])

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      if (enabled) await disableEventPush()
      else await enableEventPush(userId)
      setEnabled(!enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알림 설정을 바꾸지 못했어요.')
    } finally { setBusy(false) }
  }

  return (
    <div className="reminder-device">
      {!supported ? (
        <p className="tx-meta">iPhone에서는 가계부를 홈 화면에 추가한 뒤 그 앱에서 알림을 켜 주세요. 데스크톱은 알림을 지원하는 브라우저에서 켤 수 있어요.</p>
      ) : (
        <div className="reminder-device-row">
          <span className="tx-meta" role="status">{enabled === null ? '이 기기 알림 확인 중' : enabled ? '이 기기 알림 켜짐' : '이 기기 알림 꺼짐'}</span>
          <button type="button" className="ghost" disabled={busy || enabled === null || !userId} onClick={() => void toggle()}>
            {enabled ? '이 기기에서 끄기' : '이 기기에서 켜기'}
          </button>
        </div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  )
}
