// 구글 연결: 데스크톱(설치형 앱) OAuth + 갱신 토큰으로 접근 토큰 받기. 토큰·클라이언트 비밀은 글·로그·오류에 쓰지 않는다.
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { expandHome, type WorkerConfig } from '../config.ts'

/** drive.file 하나면 이 앱이 만든 파일만 건드린다(목록 시트도 이 권한으로 먼저 시도, 막히면 CSV로) */
export const SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const DEFAULT_CLIENT_FILE = '~/.config/recipe-worker/google-client.json'

/** 갱신이 거절됐거나 연결 정보가 없다. 토큰 글은 담지 않는다 */
export class DriveAuthError extends Error {
  constructor() {
    super('구글 연결을 다시 해야 해요')
    this.name = 'DriveAuthError'
  }
}

export type GoogleClient = { client_id: string; client_secret: string }

/** 비밀 파일 규칙과 같다: 그룹·다른 사람이 읽을 수 있으면(600이 아니면) 쓰지 않는다. 내용은 오류 글에 넣지 않는다 */
export function readClientFile(file: string): GoogleClient {
  let mode: number
  try {
    mode = statSync(file).mode
  } catch {
    throw new Error('구글 클라이언트 파일을 찾을 수 없어요')
  }
  if ((mode & 0o077) !== 0) throw new Error('구글 클라이언트 파일의 권한이 너무 열려 있어요. chmod 600 으로 바꿔 주세요')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error('구글 클라이언트 파일을 읽을 수 없어요')
  }
  const o = (raw && typeof raw === 'object' ? ((raw as Record<string, unknown>).installed ?? raw) : null) as Record<string, unknown> | null
  const id = o?.client_id
  const secret = o?.client_secret
  if (typeof id !== 'string' || !id || typeof secret !== 'string' || !secret) throw new Error('구글 클라이언트 파일에 client_id·client_secret이 없어요')
  return { client_id: id, client_secret: secret }
}

const b64url = (b: Buffer): string => b.toString('base64url')

export function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${AUTH_ENDPOINT}?${q.toString()}`
}

/** 돌아온 주소에서 code를 꺼낸다. state가 다르거나 code가 없으면 던진다 */
export function parseCallback(reqUrl: string, state: string): string {
  const u = new URL(reqUrl, 'http://127.0.0.1')
  if (u.searchParams.get('state') !== state) throw new Error('state가 맞지 않아요')
  const code = u.searchParams.get('code')
  if (!code) throw new Error('code가 없어요')
  return code
}

/** 갱신 토큰만 600 권한으로 저장한다(접근 토큰은 디스크에 두지 않는다) */
export function saveRefreshToken(file: string, refreshToken: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ refresh_token: refreshToken }), { mode: 0o600 })
  chmodSync(file, 0o600)
}

export type AuthOptions = {
  clientFile?: string
  fetchImpl?: typeof fetch
  /** 인증 주소를 보여 준다(기본 console.log). 이 주소 말고는 아무것도 출력하지 않는다 */
  print?: (url: string) => void
  timeoutMs?: number
}

/** 설치형 앱 흐름. 루프백(127.0.0.1) 서버가 state가 맞는 요청 하나만 받고 닫힌다 */
export async function googleAuth(cfg: WorkerConfig, opts: AuthOptions = {}): Promise<void> {
  if (!cfg.driveTokenFile) throw new Error('설정에 driveTokenFile이 없어요')
  const fetchImpl = opts.fetchImpl ?? fetch
  const client = readClientFile(expandHome(opts.clientFile ?? DEFAULT_CLIENT_FILE))
  const { verifier, challenge } = makePkce()
  const state = b64url(randomBytes(24))

  let finish!: (code: string) => void
  let fail!: (e: Error) => void
  const codePromise = new Promise<string>((res, rej) => { finish = res; fail = rej })
  let done = false
  const server = createServer((req, res) => {
    if (done) { res.writeHead(404).end(); return }
    let code: string
    try {
      code = parseCallback(req.url ?? '/', state)
    } catch {
      // state가 다른 요청(브라우저가 보내는 favicon 등)은 무시하고 계속 기다린다
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('맞지 않는 요청이에요')
      return
    }
    done = true
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('연결됐어요. 이 창을 닫아도 돼요.')
    finish(code)
  })
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res) })
  const timer = setTimeout(() => fail(new Error('시간이 지났어요. 다시 해 주세요')), opts.timeoutMs ?? 5 * 60_000)
  try {
    const port = (server.address() as { port: number }).port
    const redirectUri = `http://127.0.0.1:${port}/`
    ;(opts.print ?? ((u) => console.log(u)))(buildAuthUrl({ clientId: client.client_id, redirectUri, state, challenge }))
    const code = await codePromise
    let res: Response
    try {
      res = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, code_verifier: verifier, client_id: client.client_id, client_secret: client.client_secret,
          redirect_uri: redirectUri, grant_type: 'authorization_code',
        }).toString(),
      })
    } catch {
      throw new Error('구글에 닿지 못했어요')
    }
    if (!res.ok) throw new Error(`구글이 토큰 요청에 ${res.status}로 답했어요`)
    const refresh = ((await res.json().catch(() => ({}))) as { refresh_token?: unknown }).refresh_token
    if (typeof refresh !== 'string' || !refresh) throw new Error('갱신 토큰을 받지 못했어요. 구글 계정의 앱 연결을 지우고 다시 해 주세요')
    saveRefreshToken(cfg.driveTokenFile, refresh)
  } finally {
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
  }
}

export type TokenSource = { get: (force?: boolean) => Promise<string> }

/** 갱신 토큰으로 접근 토큰을 받고 만료 전까지 메모리에 둔다 */
export function createTokenSource(tokenFile: string, clientFile: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): TokenSource {
  let cached: { token: string; expires: number } | null = null
  async function refresh(): Promise<string> {
    let refreshToken: unknown
    try {
      refreshToken = (JSON.parse(readFileSync(tokenFile, 'utf8')) as { refresh_token?: unknown }).refresh_token
    } catch {
      throw new DriveAuthError()
    }
    if (typeof refreshToken !== 'string' || !refreshToken) throw new DriveAuthError()
    let client: GoogleClient
    try {
      client = readClientFile(clientFile)
    } catch {
      throw new DriveAuthError()
    }
    let res: Response
    try {
      res = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken, client_id: client.client_id, client_secret: client.client_secret, grant_type: 'refresh_token',
        }).toString(),
      })
    } catch {
      throw new Error('구글에 닿지 못했어요')
    }
    if (res.status === 400 || res.status === 401) throw new DriveAuthError() // invalid_grant 등. 408·429 같은 일시 오류는 아래에서 보통 오류로
    if (!res.ok) throw new Error(`구글이 토큰 갱신에 ${res.status}로 답했어요`)
    const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown }
    if (typeof j.access_token !== 'string' || !j.access_token) throw new DriveAuthError()
    const sec = typeof j.expires_in === 'number' ? j.expires_in : 3600
    cached = { token: j.access_token, expires: now() + Math.max(0, sec - 60) * 1000 }
    return cached.token
  }
  return {
    async get(force = false) {
      if (!force && cached && now() < cached.expires) return cached.token
      return refresh()
    },
  }
}
