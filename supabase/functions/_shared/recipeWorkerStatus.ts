// 처리기(맥)·서버 함수·앱이 함께 쓰는 정해진 말과 번호. DB(마이그레이션)의 check·오류 번호와 같아야 한다(tests/recipes/db.test.ts).
// 상대 가져오기에는 .ts를 붙이고 enum·namespace는 쓰지 않는다(처리기는 Node 형 지우기로 돈다).

/**
 * 사본(구글 드라이브·옵시디언)을 쓰지 못할 때 처리기가 알리는 까닭. 화면에 그대로 보인다.
 * 오류 글·경로·토큰은 보내지 않고 이 말 중 하나만 보낸다. recipe.worker_status.export_issue의 check와 같다.
 */
export const EXPORT_ISSUES = ['구글 드라이브 연결이 끊겼어요', '구글 드라이브에 쓰지 못했어요', '옵시디언 폴더에 쓰지 못했어요'] as const
export type ExportIssue = (typeof EXPORT_ISSUES)[number]

export function isExportIssue(v: unknown): v is ExportIssue {
  return typeof v === 'string' && (EXPORT_ISSUES as readonly string[]).includes(v)
}

/** import_recipe가 같은 출처의 레시피가 레시피북에 있어 덮지 않을 때 내는 SQLSTATE(마이그레이션의 errcode와 같다) */
export const RECIPE_EXISTS_CODE = 'RCP01'
/** 그때 서버 함수가 409 답의 code에 담는 말과, 처리기가 대기 줄에 남기는 까닭 */
export const RECIPE_EXISTS = 'recipe_exists'
export const RECIPE_EXISTS_REASON = '이미 레시피북에 있어요'
