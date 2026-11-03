// Iconify에서 Phosphor 아이콘 하나를 가져와 앱 아이콘 컴포넌트로 바꾼다. 규칙은 docs/design-resources.md 5절.
//
//   node scripts/iconify-icon.mjs ph:piggy-bank                  # 컴포넌트를 화면에만 찍는다(파일은 그대로)
//   node scripts/iconify-icon.mjs ph:receipt --name BillIcon --write
//
// --write: src/components/Icons.tsx 끝에 붙이고, CREDITS.md 아이콘 표에 한 줄 더하고,
//          그 세트의 라이선스 원문이 public/licenses/에 없으면 받아 둔다(MIT는 저작권 표시를 함께 배포해야 한다).
// 앱은 실행 중에 Iconify를 부르지 않는다. 도형은 코드에 들어가고, 이 스크립트만 개발할 때 api.iconify.design을 부른다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALLOWED_SETS, checkCollection, componentName, creditRow, parseIconId, renderComponent, resolveIcon, toJsxChildren } from './iconify-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICONS = join(ROOT, 'src/components/Icons.tsx')
const CREDITS = join(ROOT, 'CREDITS.md')
const CREDITS_HEADING = '## 아이콘 (Iconify)'

const args = process.argv.slice(2)
const write = args.includes('--write')
const nameAt = args.indexOf('--name')
const id = args.find((a, i) => !a.startsWith('--') && !(nameAt >= 0 && i === nameAt + 1))

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} 응답 ${res.status}`)
  return res.json()
}

function addCreditRow(row) {
  const lines = readFileSync(CREDITS, 'utf8').split('\n')
  const at = lines.indexOf(CREDITS_HEADING)
  if (at < 0) throw new Error(`CREDITS.md에 '${CREDITS_HEADING}' 제목이 없다.`)
  let last = lines.findIndex((l, i) => i > at && l.startsWith('|'))
  if (last < 0) throw new Error('CREDITS.md 아이콘 표를 찾지 못했다.')
  while (lines[last + 1]?.startsWith('|')) last++
  lines.splice(last + 1, 0, row)
  writeFileSync(CREDITS, lines.join('\n'))
}

async function ensureLicense(prefix) {
  const file = join(ROOT, 'public/licenses', `${prefix}-LICENSE.txt`)
  if (existsSync(file)) return false
  const set = ALLOWED_SETS[prefix]
  const res = await fetch(set.licenseRaw)
  if (!res.ok) throw new Error(`${set.licenseRaw} 응답 ${res.status}`)
  const text = await res.text()
  if (!text.includes(`${set.spdx} License`)) throw new Error(`${prefix} 라이선스 원문이 ${set.spdx}가 아니다. docs/design-resources.md를 다시 정한 뒤 쓴다.`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return true
}

async function main() {
  const { prefix, name } = parseIconId(id)
  const component = nameAt >= 0 ? args[nameAt + 1] : componentName(name)
  if (!/^[A-Z][A-Za-z0-9]*$/.test(component ?? '')) throw new Error(`컴포넌트 이름이 맞지 않다: ${component}`)

  checkCollection(prefix, await getJson(`https://api.iconify.design/collections?prefixes=${prefix}`))
  const body = resolveIcon(await getJson(`https://api.iconify.design/${prefix}.json?icons=${name}`), name)
  const code = renderComponent({ component, prefix, name, jsx: toJsxChildren(body, ALLOWED_SETS[prefix].mode) })

  if (!write) {
    process.stdout.write(code)
    process.stderr.write(`\n파일은 바꾸지 않았다. 붙이려면 --write를 더한다.\n`)
    return
  }
  const icons = readFileSync(ICONS, 'utf8')
  if (new RegExp(`export const ${component}\\b`).test(icons)) throw new Error(`Icons.tsx에 ${component}가 이미 있다. --name으로 다른 이름을 준다.`)
  writeFileSync(ICONS, `${icons.trimEnd()}\n${code}`)
  const date = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  addCreditRow(creditRow({ component, prefix, name, date }))
  const newLicense = await ensureLicense(prefix)
  process.stdout.write(`${component}를 Icons.tsx에 붙이고 CREDITS.md에 적었다.${newLicense ? ` public/licenses/${prefix}-LICENSE.txt를 받아 두었다.` : ''}\n`)
  process.stdout.write('쓰는 화면을 npm run screens로 390·1280px, 라이트·다크 캡처해 기존 아이콘 옆에서 굵기·크기를 본다.\n')
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`)
  process.exit(1)
})
