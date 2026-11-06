import { sb } from './supabase'

export interface ReminderFields {
  reminder_offset_minutes?: number | null
  reminder_recipient?: string | null
}

const table = 'event_push_subscriptions'

export function canReceiveEventPush(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function getDeviceRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!canReceiveEventPush()) return
  return navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
}

export async function isEventPushEnabled(userId: string): Promise<boolean> {
  const reg = await getDeviceRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub || Notification.permission !== 'granted') return false
  const { data, error } = await sb().from(table).select('id').eq('endpoint', sub.endpoint).eq('user_id', userId).maybeSingle()
  if (error) throw new Error('이 기기의 알림 상태를 확인하지 못했어요.')
  return data !== null
}

export async function enableEventPush(userId: string): Promise<void> {
  if (!canReceiveEventPush()) throw new Error('이 기기에서 알림을 받을 수 없어요.')
  // iPhone의 홈 화면 앱에서는 버튼을 누른 동작에서 바로 권한을 물어야 한다.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림을 받으려면 기기 설정에서 가계부 알림을 허용해 주세요.')

  const reg = await getDeviceRegistration()
  if (!reg?.active) throw new Error('앱을 다시 열고 이 기기의 알림을 켜 주세요.')
  const { data, error } = await sb().functions.invoke<{ publicKey: string }>('event-reminders', { method: 'GET' })
  if (error || !data?.publicKey || !/^[a-zA-Z0-9_-]{87}$/.test(data.publicKey)) {
    throw new Error('알림 서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.')
  }
  const publicKey = Uint8Array.from(atob(data.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='), (char) => char.charCodeAt(0))
  let sub = await reg.pushManager.getSubscription()
  const key = sub?.options.applicationServerKey
  if (sub && (!key || new Uint8Array(key).some((byte, i) => byte !== publicKey[i]) || key.byteLength !== publicKey.byteLength)) {
    await disableEventPush()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
  const { keys } = sub.toJSON()
  if (!keys?.p256dh || !keys.auth) throw new Error('이 기기의 알림 등록 정보를 읽지 못했어요.')
  const result = await sb().from(table).upsert({
    user_id: userId, endpoint: sub.endpoint, p256dh: keys.p256dh, auth_key: keys.auth,
  }, { onConflict: 'endpoint' })
  if (result.error) throw new Error('이 기기를 등록하지 못했어요. 잠시 뒤 다시 해 주세요.')
}

export async function disableEventPush(): Promise<void> {
  const reg = await getDeviceRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const { error } = await sb().from(table).delete().eq('endpoint', sub.endpoint)
  // DB에 닿지 않아도 이 기기의 푸시 주소는 폐기한다.
  const unsubscribed = await sub.unsubscribe().catch(() => false)
  if (error && !unsubscribed) throw new Error('이 기기의 알림을 끄지 못했어요. 잠시 뒤 다시 해 주세요.')
}
