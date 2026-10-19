// 사진으로 상품 찾기·캡처로 가격 넣기(P4, D-009)의 클라이언트 부분: Edge Function grocery-photo 부르기(WIF 거절 시 세션 갱신 뒤 한 번 더),
// 출처 글자. 읽은 값은 화면에서 사람이 확인·고친 뒤에만 쓴다.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListItem, PhotoImage, PhotoJob, PriceRead, ProductRead } from '../../../supabase/functions/grocery-photo/photo'
import type { Member } from './types'
import type { PriceSource } from './products'

export type { ListItem, PhotoImage, PhotoJob, PriceRead, ProductRead }
export type PhotoResult =
  | { job: 'product'; product: ProductRead; query: string; model?: string }
  | { job: 'price'; price: PriceRead & { qty: number }; model?: string }
  | { job: 'list'; items: ListItem[]; note: string | null; model?: string }
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

/** 서버 오류 코드 → 장보기 화면 문구. "AI"라는 말 없이 하는 일 그대로 쓴다(CLAUDE.md). 모르는 코드는 서버 문구를 그대로. */
const ERROR_TEXT: Record<string, string> = {
  ai_not_configured: '사진 읽기 설정이 아직 안 됐어요.',
  wif_denied: '사진 읽기 서버 인증에 실패했어요. 다시 로그인한 뒤 해 주세요.',
  wif_aud_missing: '사진 읽기 서버 인증에 실패했어요. 다시 로그인한 뒤 해 주세요.',
  wif_unsupported_jwt: '사진 읽기 서버 설정이 맞지 않아요.',
  ai_error: '사진을 읽지 못했어요. 잠시 후 다시 시도하거나 직접 적어 주세요.',
  rate_limited: '잠시 후 다시 시도해 주세요.',
  refused: '이 사진은 읽을 수 없어요. 직접 적어 주세요.',
  no_household: '가계부에 참여한 뒤 쓸 수 있어요.',
  unauthorized: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  bad_request: '사진 형식이 잘못됐어요. 다른 사진으로 해 주세요.',
  network: '사진 읽기 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
}
export function photoErrorText(code: string, fallback: string): string {
  return ERROR_TEXT[code] ?? fallback
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
    if (p?.message) throw new PhotoError(p.code ?? 'error', photoErrorText(p.code ?? 'error', p.message))
    throw new PhotoError('network', photoErrorText('network', ''))
  }
}

/** 가격 줄의 출처 글자: 다나와, 캡처(올린 사람) */
export function sourceLabel(source: PriceSource, capturedBy: string | null | undefined, members: readonly Member[]): string {
  if (source === 'danawa') return '다나와'
  const m = members.find((x) => x.userId === capturedBy)
  return m ? `캡처(${m.displayName})` : '캡처'
}

export const READING_TEXT = '사진 읽는 중'
