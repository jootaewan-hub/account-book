// 다시 해도 똑같이 실패할 일(영구 실패). 일 고리는 이것을 받으면 버려 두지 않고 바로 실패로 끝내고(api.fail), 까닭을 화면에 남긴다.
// 까닭은 아래 정해진 한국어 글만 쓴다(오류 글·경로·자막이 대기 줄에 남지 않게). 그 밖의 오류는 일시 오류로 보고 버려 둔다.
import { RECIPE_EXISTS_REASON } from '../../../supabase/functions/_shared/recipeWorkerStatus.ts'

export const FAIL_PRIVATE = '비공개 영상이에요'
export const FAIL_AGE = '연령 제한 영상이에요'
export const FAIL_UNAVAILABLE = '볼 수 없는 영상이에요(지워졌거나 막혔어요)'
export const FAIL_TOO_LONG = '영상이 너무 길어요(60분 넘음)'
export const FAIL_FORMAT = '레시피 정리 결과가 형식에 맞지 않아요'
export const FAIL_EXISTS = RECIPE_EXISTS_REASON

export const FAIL_REASONS = [FAIL_PRIVATE, FAIL_AGE, FAIL_UNAVAILABLE, FAIL_TOO_LONG, FAIL_FORMAT, FAIL_EXISTS] as const
export type FailReason = (typeof FAIL_REASONS)[number]

export class JobFailed extends Error {
  reason: FailReason
  constructor(reason: FailReason) {
    // 정해진 글이 아니면 쓰지 않는다(형으로 막지만, 자바스크립트에서 부를 때도 지킨다)
    const safe: FailReason = (FAIL_REASONS as readonly string[]).includes(reason) ? reason : FAIL_FORMAT
    super(safe)
    this.name = 'JobFailed'
    this.reason = safe
  }
}
