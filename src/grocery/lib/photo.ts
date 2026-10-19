// 사진으로 상품 찾기·캡처로 가격 넣기(P4, D-009)의 클라이언트 부분: Edge Function grocery-photo 부르기(WIF 거절 시 세션 갱신 뒤 한 번 더),
// 출처 글자. 읽은 값은 화면에서 사람이 확인·고친 뒤에만 쓴다.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhotoImage, PhotoJob, PriceRead, ProductRead } from '../../../supabase/functions/grocery-photo/photo'
import type { Member } from './types'
import type { PriceSource } from './products'

export type { PhotoImage, PhotoJob, PriceRead, ProductRead }
export type PhotoResult =
  | { job: 'product'; product: ProductRead; query: string; model?: string }
  | { job: 'price'; price: PriceRead & { qty: number }; model?: string }
export type CapturedQuoteInput = { seller: string; price: number; qty: number; delivery: number | null }

export class PhotoError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PhotoError'
  }
}

async function errorPayload(error: unknown): Promise<{ code?: string; message?: string } | null> {
  const ctx = (error as { context?: unknown } | null)?.context
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).json()) as { error?: { code?: string; message?: string } }
      return body?.error ?? null
    } catch {
      return null
    }
  }
  return null
}

/** grocery-photo를 부른다. WIF 토큰 교환이 거절되면 새 로그인 토큰으로 한 번 더(가계부 smart.ts와 같은 방식). */
export async function invokePhoto(client: SupabaseClient, body: { job: PhotoJob; image: PhotoImage }): Promise<PhotoResult> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await client.functions.invoke<PhotoResult>('grocery-photo', { body })
    if (!error && data) return data
    const p = await errorPayload(error)
    if ((p?.code === 'wif_denied' || p?.code === 'wif_aud_missing') && attempt === 0) {
      await client.auth.refreshSession()
      continue
    }
    if (p?.message) throw new PhotoError(p.code ?? 'error', p.message)
    throw new PhotoError('network', '사진 읽기 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
  }
}

/** 가격 줄의 출처 글자: 다나와, 캡처(올린 사람) */
export function sourceLabel(source: PriceSource, capturedBy: string | null | undefined, members: readonly Member[]): string {
  if (source === 'danawa') return '다나와'
  const m = members.find((x) => x.userId === capturedBy)
  return m ? `캡처(${m.displayName})` : '캡처'
}

export const READING_TEXT = '사진 읽는 중'
