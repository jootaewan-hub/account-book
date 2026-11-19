// launchd 사용자 에이전트 plist를 글로 만든다. 경로는 모두 절대 경로, 셸 별칭은 쓰지 않는다.
const BASE_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

export type PlistOptions = {
  label: string
  node: string
  script: string
  logDir: string
  /** PATH 끝에 더할 폴더(예: claude가 있는 곳) */
  extraPath?: string[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function absolute(name: string, p: string): string {
  if (!p.startsWith('/')) throw new Error(`${name}은(는) 절대 경로여야 해요`)
  return p
}

export function renderPlist(o: PlistOptions): string {
  const node = absolute('node', o.node)
  const script = absolute('script', o.script)
  const logDir = absolute('logDir', o.logDir).replace(/\/+$/, '')
  const path = [...BASE_PATH, ...(o.extraPath ?? []).map((p) => absolute('PATH', p))].join(':')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${esc(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(node)}</string>
    <string>${esc(script)}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${esc(logDir)}/out.log</string>
  <key>StandardErrorPath</key>
  <string>${esc(logDir)}/err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${esc(path)}</string>
  </dict>
</dict>
</plist>
`
}
