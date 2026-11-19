// 구글 드라이브 사본(REST, SDK 없음): 폴더 → 문서(HTML을 문서로 변환) → 목록(시트, 막히면 CSV).
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { DEFAULT_CLIENT_FILE, createTokenSource, DriveAuthError } from './google.ts'
import { expandHome } from '../config.ts'
import { fileTitle, folderPath, renderHtml, type StoredRecipe } from './render.ts'

export { DriveAuthError }

const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const LIST_NAME = '레시피 목록'
const CSV_NAME = `${LIST_NAME}.csv`
const ROOT_FOLDER = '레시피'
const HEADER = ['id', '요리 이름', '요리 종류', '주재료', '세부 재료', '조리법', '난이도', '상황', '채널', '영상 주소', '저장한 날', '계량 도구', '문서 링크']

export class DriveHttpError extends Error {
  status: number
  constructor(status: number) {
    super(`구글 드라이브가 ${status}로 답했어요`)
    this.name = 'DriveHttpError'
    this.status = status
  }
}

/** 시트 API가 drive.file 권한으로 안 된다(403) → CSV로 바꾼다 */
class SheetsForbidden extends Error {}

export type DocRef = { id: string; path: string }
export type Drive = {
  ensureFolder(path: string[]): Promise<string>
  upsertDoc(r: StoredRecipe, prev: { id: string; path: string | null } | null): Promise<DocRef>
  trash(id: string): Promise<void>
  upsertListRow(r: StoredRecipe, docId?: string | null): Promise<void>
  removeListRow(recipeId: string): Promise<void>
}

export type DriveOptions = { clientFile?: string; cacheDir?: string; now?: () => number }

/** Drive 검색어의 따옴표 안 값: \ 와 ' 를 막는다 */
export const escapeQuery = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** CSV 한 칸: 수식으로 읽힐 첫 글자는 ' 를 붙이고, 모든 칸을 RFC 4180대로 따옴표로 감싼다 */
export function csvCell(v: string): string {
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return `"${guarded.replace(/"/g, '""')}"`
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

type ListState = { mode: 'sheet' | 'csv'; rows: Record<string, string[]>; sheetId?: string; csvId?: string }

function rowOf(r: StoredRecipe, docId: string | null | undefined): string[] {
  return [
    r.id, r.title, r.tags.cuisine, r.tags.mains.join(', '), r.tags.main_details.join(', '), r.tags.methods.join(', '), r.difficulty,
    r.tags.occasions.join(', '), r.source.channel ?? '', r.source.url ?? '', r.saved_at.slice(0, 10), r.measuring_tool ?? '확인 못 함',
    docId ? `https://docs.google.com/document/d/${docId}/edit` : '',
  ]
}

export function createDrive(tokenFile: string, fetchImpl: typeof fetch = fetch, opts: DriveOptions = {}): Drive {
  const token = createTokenSource(tokenFile, expandHome(opts.clientFile ?? DEFAULT_CLIENT_FILE), fetchImpl, opts.now)
  const cacheDir = expandHome(opts.cacheDir ?? '~/Library/Caches/recipe-worker')
  const stateFile = join(cacheDir, 'drive-list.json')
  const folderIds = new Map<string, string>()

  /** 접근 토큰을 붙여 부른다. 401이면 토큰을 새로 받아 한 번만 다시 */
  async function call(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
    const send = async (force: boolean): Promise<Response> => {
      const t = await token.get(force)
      try {
        return await fetchImpl(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(60_000) })
      } catch {
        throw new Error('구글에 닿지 못했어요')
      }
    }
    const res = await send(false)
    return res.status === 401 ? send(true) : res
  }
  const json = async <T>(res: Response): Promise<T> => {
    if (!res.ok) throw new DriveHttpError(res.status)
    return (await res.json()) as T
  }
  const jsonInit = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  function multipart(metadata: unknown, media: string, mediaType: string): { headers: Record<string, string>; body: string } {
    const b = `rw${randomBytes(12).toString('hex')}`
    return {
      headers: { 'content-type': `multipart/related; boundary=${b}` },
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${b}\r\nContent-Type: ${mediaType}; charset=UTF-8\r\n\r\n${media}\r\n--${b}--`,
    }
  }

  async function findChild(parent: string, name: string, mime: string): Promise<string | null> {
    const q = `name = '${escapeQuery(name)}' and mimeType = '${mime}' and '${escapeQuery(parent)}' in parents and trashed = false`
    const j = await json<{ files?: { id: string }[] }>(await call(`${FILES}?${new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' })}`))
    return j.files?.[0]?.id ?? null
  }

  async function ensureFolder(path: string[]): Promise<string> {
    let parent = 'root'
    for (const name of path) {
      const key = `${parent}\0${name}`
      let id = folderIds.get(key) ?? null
      if (!id) {
        id = await findChild(parent, name, FOLDER_MIME)
        if (!id) id = (await json<{ id: string }>(await call(FILES, jsonInit('POST', { name, mimeType: FOLDER_MIME, parents: [parent] })))).id
        folderIds.set(key, id)
      }
      parent = id
    }
    return parent
  }

  async function upsertDoc(r: StoredRecipe, prev: { id: string; path: string | null } | null): Promise<DocRef> {
    const folder = folderPath(r)
    const name = fileTitle(r)
    const path = `${folder.join('/')}/${name}`
    const folderId = await ensureFolder(folder)
    // 확인 필요: HTML을 올리면 드라이브가 구글 문서로 바꾼다고 알고 있다. 실제 모습은 배포 때 확인한다.
    const html = renderHtml(r)

    if (prev?.id) {
      let qs = 'uploadType=multipart'
      let gone = false
      const prevFolder = prev.path ? prev.path.slice(0, prev.path.lastIndexOf('/')) : null
      if (prevFolder !== folder.join('/')) {
        const g = await call(`${FILES}/${encodeURIComponent(prev.id)}?fields=parents`)
        if (g.status === 404) gone = true
        else {
          const parents = (await json<{ parents?: string[] }>(g)).parents ?? []
          const remove = parents.filter((p) => p !== folderId)
          if (!parents.includes(folderId)) qs += `&addParents=${encodeURIComponent(folderId)}`
          if (remove.length) qs += `&removeParents=${encodeURIComponent(remove.join(','))}`
        }
      }
      if (!gone) {
        const m = multipart({ name }, html, 'text/html')
        const res = await call(`${UPLOAD}/${encodeURIComponent(prev.id)}?${qs}`, { method: 'PATCH', ...m })
        if (res.status !== 404) {
          await json(res)
          return { id: prev.id, path }
        }
      }
      // 문서가 드라이브에서 사라졌다 → 새로 만든다
    }
    const m = multipart({ name, mimeType: DOC_MIME, parents: [folderId] }, html, 'text/html')
    const created = await json<{ id: string }>(await call(`${UPLOAD}?uploadType=multipart`, { method: 'POST', ...m }))
    return { id: created.id, path }
  }

  async function trash(id: string): Promise<void> {
    const res = await call(`${FILES}/${encodeURIComponent(id)}`, jsonInit('PATCH', { trashed: true }))
    if (res.status === 404) return // 이미 없다
    await json(res)
  }

  // ---- 목록 ----
  function loadState(): ListState {
    try {
      const s = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<ListState>
      return { mode: s.mode === 'csv' ? 'csv' : 'sheet', rows: s.rows && typeof s.rows === 'object' ? s.rows : {}, sheetId: s.sheetId, csvId: s.csvId }
    } catch {
      return { mode: 'sheet', rows: {} }
    }
  }
  function saveState(s: ListState): void {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(stateFile, JSON.stringify(s), { mode: 0o600 })
    chmodSync(stateFile, 0o600)
  }

  /** 시트 API 호출. 403이면 권한이 모자란 것이다 */
  async function sheets(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
    const res = await call(url, init)
    if (res.status === 403) throw new SheetsForbidden()
    return res
  }

  async function ensureSheet(s: ListState): Promise<string> {
    if (s.sheetId) return s.sheetId
    const folderId = await ensureFolder([ROOT_FOLDER])
    let id = await findChild(folderId, LIST_NAME, SHEET_MIME)
    if (!id) {
      id = (await json<{ id: string }>(await call(FILES, jsonInit('POST', { name: LIST_NAME, mimeType: SHEET_MIME, parents: [folderId] })))).id
      await json(await sheets(`${SHEETS}/${id}/values/A1:M1?valueInputOption=RAW`, jsonInit('PUT', { values: [HEADER] })))
      // 확인 필요: 새 시트의 첫 탭 sheetId가 0이라고 알고 있다
      await json(await sheets(`${SHEETS}/${id}:batchUpdate`, jsonInit('POST', {
        requests: [{ updateDimensionProperties: { range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } }],
      })))
    }
    s.sheetId = id
    saveState(s)
    return id
  }

  async function sheetRowIndex(id: string, recipeId: string): Promise<number> {
    const j = await json<{ values?: string[][] }>(await sheets(`${SHEETS}/${id}/values/A:A`))
    return (j.values ?? []).findIndex((v) => v[0] === recipeId) // 0이면 머리글 줄
  }

  async function syncCsv(s: ListState): Promise<void> {
    const text = toCsv([HEADER, ...Object.values(s.rows)])
    const folderId = await ensureFolder([ROOT_FOLDER])
    if (!s.csvId) s.csvId = (await findChild(folderId, CSV_NAME, 'text/csv')) ?? undefined
    if (s.csvId) {
      const res = await call(`${UPLOAD}/${encodeURIComponent(s.csvId)}?uploadType=multipart`, { method: 'PATCH', ...multipart({ name: CSV_NAME }, text, 'text/csv') })
      if (res.status !== 404) { await json(res); saveState(s); return }
    }
    const m = multipart({ name: CSV_NAME, mimeType: 'text/csv', parents: [folderId] }, text, 'text/csv')
    s.csvId = (await json<{ id: string }>(await call(`${UPLOAD}?uploadType=multipart`, { method: 'POST', ...m }))).id
    saveState(s)
  }

  async function listChange(recipeId: string, row: string[] | null): Promise<void> {
    const s = loadState()
    if (row) s.rows[recipeId] = row
    else delete s.rows[recipeId]
    saveState(s) // 오류가 나도 행은 남겨 다음에 CSV를 다시 올릴 수 있게
    if (s.mode === 'sheet') {
      try {
        const sheet = await ensureSheet(s)
        const idx = await sheetRowIndex(sheet, recipeId)
        if (row) {
          if (idx > 0) await json(await sheets(`${SHEETS}/${sheet}/values/A${idx + 1}:M${idx + 1}?valueInputOption=RAW`, jsonInit('PUT', { values: [row] })))
          else await json(await sheets(`${SHEETS}/${sheet}/values/A:M:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, jsonInit('POST', { values: [row] })))
        } else if (idx > 0) {
          await json(await sheets(`${SHEETS}/${sheet}:batchUpdate`, jsonInit('POST', {
            requests: [{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }],
          })))
        }
        return
      } catch (e) {
        if (!(e instanceof SheetsForbidden)) throw e
        s.mode = 'csv'
        saveState(s)
      }
    }
    await syncCsv(s)
  }

  return {
    ensureFolder,
    upsertDoc,
    trash,
    upsertListRow: (r, docId) => listChange(r.id, rowOf(r, docId)),
    removeListRow: (recipeId) => listChange(recipeId, null),
  }
}
