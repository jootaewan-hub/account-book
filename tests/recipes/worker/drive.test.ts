import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { difficulty } from '../../../supabase/functions/_shared/recipeClassify'
import type { RecipeV2 } from '../../../supabase/functions/_shared/recipeContract'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { createDrive, csvCell, escapeQuery, toCsv, DriveAuthError } from '../../../tools/recipe-worker/src/export/drive'
import { buildAuthUrl, googleAuth, makePkce, parseCallback, readClientFile, saveRefreshToken } from '../../../tools/recipe-worker/src/export/google'
import type { WorkerConfig } from '../../../tools/recipe-worker/src/config'
import gold from '../../../docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json'

function stored(over: Partial<StoredRecipe> = {}): StoredRecipe {
  const r = structuredClone(gold) as unknown as RecipeV2
  const d = difficulty(r)
  return {
    ...r, id: 'rec-1', difficulty: d.level, difficulty_basis: d.basis, memo: null, rating: null, favorite: false,
    saved_at: '2026-11-19T01:00:00Z', updated_at: '2026-11-19T01:00:00Z', ...over,
  }
}

const SECRET_REFRESH = 'REFRESH-TOKEN-SECRET-xyz'
const SECRET_CLIENT = 'CLIENT-SECRET-abc'

type Call = { method: string; url: string; body: string; auth: string | null }
type FakeFile = { id: string; name: string; mime: string; parents: string[]; trashed: boolean; content: string }

/** 가짜 구글. 실제 네트워크는 쓰지 않는다 */
function fakeGoogle(opts: { sheets403?: boolean; refreshStatus?: number; reject401Once?: boolean } = {}) {
  const files: FakeFile[] = []
  const calls: Call[] = []
  const sheetValues: string[][] = []
  let n = 0
  let tokenCount = 0
  let reject401 = opts.reject401Once ?? false
  const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const parseMulti = (body: string) => {
    const parts = body.split(/--rw[0-9a-f]+/).filter((p) => p.includes('Content-Type'))
    const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].replace(/\r\n$/, ''))
    const content = parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, '')
    return { meta, content }
  }
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? init.body : ''
    const auth = new Headers(init.headers).get('authorization')
    calls.push({ method, url, body, auth })
    const u = new URL(url)
    if (u.host === 'oauth2.googleapis.com') {
      if (opts.refreshStatus && opts.refreshStatus !== 200) return res(opts.refreshStatus, { error: 'invalid_grant' })
      tokenCount++
      return res(200, { access_token: `AT${tokenCount}`, expires_in: 3600 })
    }
    if (reject401 && auth === 'Bearer AT1' && !u.pathname.startsWith('/v4')) { reject401 = false; return res(401) }
    if (u.host === 'sheets.googleapis.com') {
      if (opts.sheets403) return res(403, { error: 'insufficient scope' })
      if (u.pathname.endsWith('/values/A:A')) return res(200, { values: sheetValues.map((r) => [r[0]]) })
      if (u.pathname.includes(':append')) { sheetValues.push((JSON.parse(body) as { values: string[][] }).values[0]); return res(200) }
      if (method === 'PUT' && /values\/A(\d+):M\d+/.test(u.pathname)) {
        const idx = Number(/values\/A(\d+):M/.exec(u.pathname)![1]) - 1
        sheetValues[idx] = (JSON.parse(body) as { values: string[][] }).values[0]
        return res(200)
      }
      if (method === 'PUT' && u.pathname.includes('A1:M1')) { sheetValues[0] = (JSON.parse(body) as { values: string[][] }).values[0]; return res(200) }
      if (u.pathname.endsWith(':batchUpdate')) {
        const del = (JSON.parse(body) as { requests: { deleteDimension?: { range: { startIndex: number } } }[] }).requests[0].deleteDimension
        if (del) sheetValues.splice(del.range.startIndex, 1)
        return res(200)
      }
      return res(404)
    }
    if (u.pathname.startsWith('/upload/drive/v3/files')) {
      const { meta, content } = parseMulti(body)
      const id = u.pathname.split('/')[5]
      if (method === 'POST') {
        const f: FakeFile = { id: `f${++n}`, name: meta.name, mime: meta.mimeType ?? 'text/html', parents: meta.parents ?? [], trashed: false, content }
        files.push(f)
        return res(200, { id: f.id })
      }
      const f = files.find((x) => x.id === id && !x.trashed)
      if (!f) return res(404)
      f.name = meta.name ?? f.name
      f.content = content
      const add = u.searchParams.get('addParents')
      const rem = u.searchParams.get('removeParents')
      if (rem) f.parents = f.parents.filter((p) => !rem.split(',').includes(p))
      if (add) f.parents.push(add)
      return res(200, { id: f.id })
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') ?? ''
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)![1].replace(/\\(.)/g, '$1')
      const mime = /mimeType = '([^']+)'/.exec(q)![1]
      const parent = /'([^']+)' in parents/.exec(q)![1]
      const hit = files.find((f) => f.name === name && f.mime === mime && f.parents.includes(parent) && !f.trashed)
      return res(200, { files: hit ? [{ id: hit.id }] : [] })
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const m = JSON.parse(body) as { name: string; mimeType: string; parents: string[] }
      const f: FakeFile = { id: `f${++n}`, name: m.name, mime: m.mimeType, parents: m.parents, trashed: false, content: '' }
      files.push(f)
      return res(200, { id: f.id })
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)
    if (one) {
      const f = files.find((x) => x.id === one[1])
      if (!f) return res(404)
      if (method === 'GET') return res(200, { parents: f.parents })
      if (method === 'PATCH') { if (JSON.parse(body).trashed) f.trashed = true; return res(200, { id: f.id }) }
    }
    return res(404)
  }) as typeof fetch
  return { fetchImpl, files, calls, sheetValues, get tokens() { return tokenCount } }
}

let dir: string
let tokenFile: string
let clientFile: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drive-test-'))
  tokenFile = join(dir, 'token.json')
  clientFile = join(dir, 'client.json')
  writeFileSync(tokenFile, JSON.stringify({ refresh_token: SECRET_REFRESH }), { mode: 0o600 })
  writeFileSync(clientFile, JSON.stringify({ client_id: 'cid', client_secret: SECRET_CLIENT }), { mode: 0o600 })
})
const mk = (g: ReturnType<typeof fakeGoogle>) => createDrive(tokenFile, g.fetchImpl, { clientFile, cacheDir: join(dir, 'cache') })

describe('검색어 이스케이프', () => {
  it('역슬래시와 작은따옴표를 막는다', () => {
    expect(escapeQuery(String.raw`a'b\c`)).toBe(String.raw`a\'b\\c`)
  })
  it('폴더 이름의 따옴표가 검색어를 깨지 못한다', async () => {
    const g = fakeGoogle()
    await mk(g).ensureFolder([`엄마's \\ 레시피`])
    const q = new URL(g.calls.find((c) => c.method === 'GET' && c.url.includes('/drive/v3/files?'))!.url).searchParams.get('q')!
    expect(q).toContain(String.raw`name = '엄마\'s \\ 레시피'`)
  })
})

describe('createDrive', () => {
  it('처음 올림: 폴더 다섯 단계, 문서 하나(구글 문서로), 목록 한 줄', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    const r = stored()
    const doc = await d.upsertDoc(r, null)
    await d.upsertListRow(r, doc.id)
    const folders = g.files.filter((f) => f.mime === 'application/vnd.google-apps.folder')
    expect(folders.map((f) => f.name)).toEqual(['레시피', '한식', '돼지고기', '볶음', '보통'])
    const docs = g.files.filter((f) => f.mime === 'application/vnd.google-apps.document')
    expect(docs).toHaveLength(1)
    expect(docs[0].content).toContain('<html')
    expect(doc.path).toBe('레시피/한식/돼지고기/볶음/보통/기사식당 바싹 제육볶음 (셰프호윤 Chef Hoyoon)')
    expect(g.sheetValues).toHaveLength(2) // 머리글 + 한 줄
    expect(g.sheetValues[1][0]).toBe('rec-1')
    expect(g.sheetValues[0]).toHaveLength(13)
    expect(g.sheetValues[1]).toHaveLength(13)
    expect(g.sheetValues[1][1]).toBe(r.title)
    expect(g.sheetValues[1][3]).toBe(r.tags.mains.join(', '))
    expect(g.sheetValues[1][11]).toBe('확인 못 함')
    expect(g.sheetValues[1][12]).toContain(doc.id)
  })

  it('내용만 바뀜: 같은 문서 id를 바꾸고 새로 만들지 않는다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    const r = stored()
    const a = await d.upsertDoc(r, null)
    const b = await d.upsertDoc({ ...r, title: r.title }, a)
    await d.upsertListRow(r, a.id)
    await d.upsertListRow(r, a.id)
    expect(b.id).toBe(a.id)
    expect(g.files.filter((f) => f.mime === 'application/vnd.google-apps.document')).toHaveLength(1)
    expect(g.sheetValues).toHaveLength(2) // 같은 id 줄은 덮어쓴다
  })

  it('분류가 바뀜: 같은 id를 새 폴더로 옮긴다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    const r = stored()
    const a = await d.upsertDoc(r, null)
    const moved = stored({ difficulty: '어려움' })
    const b = await d.upsertDoc(moved, a)
    expect(b.id).toBe(a.id)
    expect(b.path).toContain('/어려움/')
    const f = g.files.find((x) => x.id === a.id)!
    const hard = g.files.find((x) => x.name === '어려움')!
    expect(f.parents).toEqual([hard.id])
    const patch = g.calls.find((c) => c.method === 'PATCH' && c.url.includes('/upload/'))!
    expect(patch.url).toContain('addParents=')
    expect(patch.url).toContain('removeParents=')
  })

  it('폴더 id는 한 번 찾으면 메모리에 둔다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    await d.ensureFolder(['레시피', '한식'])
    const before = g.calls.length
    await d.ensureFolder(['레시피', '한식'])
    expect(g.calls.length).toBe(before)
  })

  it('휴지통: trashed true, 404는 이미 지운 것으로 본다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    const a = await d.upsertDoc(stored(), null)
    await d.trash(a.id)
    expect(g.files.find((f) => f.id === a.id)!.trashed).toBe(true)
    await expect(d.trash('없는-id')).resolves.toBeUndefined()
  })

  it('드라이브에서 사라진 문서면 새로 만든다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    const b = await d.upsertDoc(stored(), { id: 'gone', path: null })
    expect(b.id).not.toBe('gone')
    expect(g.files.some((f) => f.id === b.id)).toBe(true)
  })

  it('401이면 토큰을 한 번 갱신하고 다시 한다', async () => {
    const g = fakeGoogle({ reject401Once: true })
    await mk(g).ensureFolder(['레시피'])
    expect(g.tokens).toBe(2)
    expect(g.calls.filter((c) => c.auth === 'Bearer AT2').length).toBeGreaterThan(0)
  })

  it('접근 토큰은 만료 전까지 다시 쓴다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    await d.ensureFolder(['a'])
    await d.ensureFolder(['b'])
    expect(g.tokens).toBe(1)
  })

  it('갱신이 거절되면(invalid_grant) DriveAuthError, 글에 토큰이 없다', async () => {
    const g = fakeGoogle({ refreshStatus: 400 })
    const err = await mk(g).ensureFolder(['레시피']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DriveAuthError)
    expect((err as Error).message).toBe('구글 연결을 다시 해야 해요')
    const all = JSON.stringify([(err as Error).message, (err as Error).stack])
    expect(all).not.toContain(SECRET_REFRESH)
    expect(all).not.toContain(SECRET_CLIENT)
  })

  it('토큰 갱신이 408·429·500이면 일시 오류이지 DriveAuthError가 아니다', async () => {
    for (const status of [408, 429, 500]) {
      const g = fakeGoogle({ refreshStatus: status })
      const err = await mk(g).ensureFolder(['레시피']).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(DriveAuthError)
      expect((err as Error).message).not.toContain('다시 해야 해요')
    }
    const g = fakeGoogle({ refreshStatus: 401 })
    expect(await mk(g).ensureFolder(['레시피']).catch((e: unknown) => e)).toBeInstanceOf(DriveAuthError)
  })

  it('토큰 파일이 없으면 DriveAuthError', async () => {
    const g = fakeGoogle()
    const d = createDrive(join(dir, 'none.json'), g.fetchImpl, { clientFile, cacheDir: join(dir, 'cache') })
    await expect(d.ensureFolder(['x'])).rejects.toBeInstanceOf(DriveAuthError)
  })
})

describe('목록', () => {
  it('시트: 지우면 그 줄이 빠진다', async () => {
    const g = fakeGoogle()
    const d = mk(g)
    await d.upsertListRow(stored({ id: 'a' }), 'd1')
    await d.upsertListRow(stored({ id: 'b' }), 'd2')
    await d.removeListRow('a')
    expect(g.sheetValues.map((r) => r[0])).toEqual(['id', 'b'])
  })

  it('시트 API가 403이면 CSV로 바꾸고 그 방식을 저장한다', async () => {
    const g = fakeGoogle({ sheets403: true })
    const d = mk(g)
    await d.upsertListRow(stored({ id: 'a', title: '=HYPERLINK("x")' }), 'd1')
    const csv = g.files.find((f) => f.name === '레시피 목록.csv')!
    expect(csv.content).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv.content.split('\r\n')[0]).toBe('"id","요리 이름","요리 종류","주재료","세부 재료","조리법","난이도","상황","채널","영상 주소","저장한 날","계량 도구","문서 링크"')
    const state = JSON.parse(readFileSync(join(dir, 'cache', 'drive-list.json'), 'utf8'))
    expect(state.mode).toBe('csv')
    expect((statSync(join(dir, 'cache', 'drive-list.json')).mode & 0o777)).toBe(0o600)
    // 다음 번에는 시트를 부르지 않고 같은 CSV 파일을 다시 올린다
    const sheetCalls = g.calls.filter((c) => c.url.includes('sheets.googleapis.com')).length
    await d.upsertListRow(stored({ id: 'b' }), 'd2')
    expect(g.calls.filter((c) => c.url.includes('sheets.googleapis.com')).length).toBe(sheetCalls)
    expect(g.files.filter((f) => f.name === '레시피 목록.csv')).toHaveLength(1)
    expect(csv.content.split('\r\n').filter(Boolean)).toHaveLength(3)
    await d.removeListRow('a')
    expect(csv.content.split('\r\n').filter(Boolean)).toHaveLength(2)
  })
})

describe('CSV', () => {
  it('= + - @ 로 시작하는 칸은 따옴표 앞에 \' 를 붙인다', () => {
    for (const c of ['=1+1', '+1', '-1', '@sum']) expect(csvCell(c)).toBe(`"'${c}"`)
    expect(csvCell('일반')).toBe('"일반"')
  })
  it('RFC 4180: 쉼표·따옴표·줄바꿈', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"')
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('"a","b"\r\n"c","d"\r\n')
  })
})

describe('google 인증 조각', () => {
  it('인증 주소: PKCE(S256)·state·권한 하나·루프백', () => {
    const p = makePkce()
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555/', state: 'st', challenge: p.challenge }))
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe(p.challenge)
    expect(u.searchParams.get('state')).toBe('st')
    expect(u.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5555/')
    expect(p.verifier.length).toBeGreaterThanOrEqual(43)
    expect(p.challenge).not.toBe(p.verifier)
  })
  it('돌아온 주소: state가 다르면 거절', () => {
    expect(parseCallback('/?code=C&state=ok', 'ok')).toBe('C')
    expect(() => parseCallback('/?code=C&state=bad', 'ok')).toThrow()
    expect(() => parseCallback('/?state=ok', 'ok')).toThrow()
  })
  it('갱신 토큰 파일은 600', () => {
    const f = join(dir, 'sub', 't.json')
    saveRefreshToken(f, 'RT')
    expect(statSync(f).mode & 0o777).toBe(0o600)
    saveRefreshToken(f, 'RT2') // 덮어써도 600
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({ refresh_token: 'RT2' })
  })
  it('클라이언트 파일 권한이 열려 있으면 읽지 않고, 오류 글에 내용이 없다', () => {
    chmodSync(clientFile, 0o644)
    const err = (() => { try { readClientFile(clientFile) } catch (e) { return e as Error } })()
    expect(err?.message).toContain('권한')
    expect(err?.message).not.toContain(SECRET_CLIENT)
    chmodSync(clientFile, 0o600)
    expect(readClientFile(clientFile).client_id).toBe('cid')
  })

  it('googleAuth: 가짜 구글로 끝까지(루프백만 실제), 틀린 state는 무시, 토큰 600, 인증 주소 외에는 출력 없음', async () => {
    const outFile = join(dir, 'saved.json')
    const cfg = { driveTokenFile: outFile } as WorkerConfig
    const printed: string[] = []
    let tokenBody = ''
    const fetchImpl = (async (_u: unknown, init: RequestInit) => {
      tokenBody = String(init.body)
      return new Response(JSON.stringify({ refresh_token: 'NEW-RT', access_token: 'x' }), { status: 200 })
    }) as typeof fetch
    const p = googleAuth(cfg, { clientFile, fetchImpl, print: (u) => printed.push(u) })
    while (printed.length === 0) await new Promise((r) => setTimeout(r, 5))
    expect(printed).toHaveLength(1)
    const u = new URL(printed[0])
    const redirect = u.searchParams.get('redirect_uri')!
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    const bad = await fetch(`${redirect}?code=EVIL&state=wrong`)
    expect(bad.status).toBe(400)
    const ok = await fetch(`${redirect}?code=GOOD&state=${u.searchParams.get('state')}`)
    expect(ok.status).toBe(200)
    await p
    const body = new URLSearchParams(tokenBody)
    expect(body.get('code')).toBe('GOOD')
    expect(body.get('code_verifier')).toBeTruthy()
    expect(body.get('redirect_uri')).toBe(redirect)
    expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({ refresh_token: 'NEW-RT' })
    expect(statSync(outFile).mode & 0o777).toBe(0o600)
    await expect(fetch(redirect)).rejects.toThrow() // 서버가 닫혔다
  })
})
