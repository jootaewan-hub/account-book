// Iconify 아이콘을 이 앱의 아이콘 모양(src/components/Icons.tsx)으로 바꾸는 순수 함수들. 네트워크·파일은 iconify-icon.mjs가 맡는다.
// 규칙은 docs/design-resources.md 5절: 앱 아이콘은 Phosphor 한 가족(보통 굵기, 켜진 탭은 -fill)만 쓴다(D-048).

/** 가져와도 되는 세트. 라이선스만 보지 않고 세트를 고정한다(한 가족으로 모양을 맞추려고). */
export const ALLOWED_SETS = {
  ph: {
    title: 'Phosphor',
    spdx: 'MIT',
    holder: 'Phosphor Icons',
    home: 'https://github.com/phosphor-icons/core',
    licenseRaw: 'https://raw.githubusercontent.com/phosphor-icons/core/main/LICENSE',
    grid: 256,
  },
}

const ELEMENTS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
const GEOMETRY = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'transform'])
// 굵기는 보통(이름 끝 없음)·채움(-fill)과, 18px 이하 작은 표시용 굵게(-bold)만. 가는·두 톤은 받지 않는다
const OTHER_WEIGHTS = /-(thin|light|duotone)$/

const fail = (msg) => { throw new Error(msg) }

/** 'ph:calendar-blank' → { prefix, name } */
export function parseIconId(id) {
  const m = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id ?? '')
  if (!m) fail(`아이콘 이름은 '세트:이름' 꼴로 적는다(예: ph:wallet). 받은 값: ${id}`)
  const [, prefix, name] = m
  if (!ALLOWED_SETS[prefix]) fail(`${prefix} 세트는 쓰지 않는다. 쓸 수 있는 세트: ${Object.keys(ALLOWED_SETS).join(', ')}`)
  if (OTHER_WEIGHTS.test(name)) fail(`${name}은 다른 굵기다. 보통·채움(-fill)·작은 표시용 굵게(-bold)만 쓴다.`)
  return { prefix, name }
}

/** 'cloud-sun' → 'CloudSunIcon', 'calendar-blank-fill' → 'CalendarBlankFillIcon' */
export function componentName(name) {
  const base = name.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  return /^[A-Z]/.test(base) ? `${base}Icon` : `Icon${base}`
}

/** Iconify /collections 응답에서 세트 정보가 고정해 둔 라이선스와 같은지 본다. 세트가 라이선스를 바꾸면 멈춘다. */
export function checkCollection(prefix, collections) {
  const want = ALLOWED_SETS[prefix]
  const info = collections?.[prefix]
  if (!info) fail(`Iconify에 ${prefix} 세트 정보가 없다.`)
  if (info.license?.spdx !== want.spdx) fail(`${prefix} 라이선스가 ${want.spdx}에서 ${info.license?.spdx ?? '알 수 없음'}로 바뀌었다. docs/design-resources.md를 다시 정한 뒤 쓴다.`)
  return info
}

/** Iconify /{prefix}.json?icons= 응답에서 아이콘 하나를 꺼낸다. 별칭은 부모로 따라가되 돌리기·뒤집기가 붙은 별칭은 받지 않는다. */
export function resolveIcon(json, name) {
  if (json?.not_found?.includes(name)) fail(`${json.prefix}:${name} 아이콘이 없다.`)
  let key = name
  const alias = json?.aliases?.[name]
  if (alias) {
    const extra = Object.keys(alias).filter((k) => k !== 'parent')
    if (extra.length) fail(`${name}은 변형(${extra.join(', ')})이 붙은 별칭이다. 부모 아이콘 ${alias.parent}를 쓴다.`)
    key = alias.parent
  }
  const icon = json?.icons?.[key]
  if (!icon) fail(`${json?.prefix}:${name} 아이콘 본문이 응답에 없다.`)
  const grid = ALLOWED_SETS[json.prefix]?.grid
  const width = icon.width ?? json.width ?? 16
  const height = icon.height ?? json.height ?? 16
  if (width !== grid || height !== grid) fail(`${name}은 ${width}×${height}다. ${grid}×${grid} 격자만 쓴다.`)
  if (icon.left || icon.top || json.left || json.top) fail(`${name}은 격자 원점이 옮겨져 있다.`)
  return icon.body
}

const camel = (attr) => attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/** Iconify body(SVG 안쪽) → JSX 자식 문자열. 채움(fill="currentColor")은 앱의 base가 맡으므로 빼고, 속성 없는 <g>는 벗긴다. */
export function toJsxChildren(body) {
  const tagRe = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>/g
  const out = []
  const stack = [] // 여는 <g>마다 출력에 남겼는지
  let pos = 0
  let filled = false
  for (const m of body.matchAll(tagRe)) {
    if (body.slice(pos, m.index).trim()) fail(`태그 밖에 글자가 있다: ${body.slice(pos, m.index).trim().slice(0, 40)}`)
    pos = m.index + m[0].length
    const [, closing, tag, rawAttrs, selfClose] = m
    if (!ELEMENTS.has(tag)) fail(`${tag} 요소는 받지 않는다(도형만).`)
    if (closing) {
      if (tag !== 'g') fail(`닫는 태그 </${tag}>는 예상하지 못했다.`)
      if (stack.length === 0) fail('짝이 없는 </g>가 있다.')
      if (stack.pop()) out.push('</g>')
      continue
    }
    const kept = []
    for (const [, attr, value] of rawAttrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      if (attr === 'fill') {
        if (value !== 'currentColor') fail(`${tag}의 fill="${value}"는 앱 아이콘 모양이 아니다(한 색 채움만).`)
        filled = true
        continue
      }
      if (!GEOMETRY.has(attr)) fail(`${tag}의 ${attr} 속성은 받지 않는다.`)
      kept.push(`${camel(attr)}="${value}"`)
    }
    const open = `<${tag}${kept.length ? ` ${kept.join(' ')}` : ''}`
    if (tag === 'g') {
      if (selfClose) continue
      stack.push(kept.length > 0)
      if (kept.length > 0) out.push(`${open}>`)
      continue
    }
    if (!selfClose) fail(`<${tag}>는 스스로 닫혀야 한다.`)
    out.push(`${open} />`)
  }
  if (body.slice(pos).trim()) fail(`태그 밖에 글자가 있다: ${body.slice(pos).trim().slice(0, 40)}`)
  if (stack.length) fail('닫히지 않은 <g>가 있다.')
  if (!filled) fail('한 색 채움(fill="currentColor") 아이콘이 아니다.')
  if (!out.length) fail('그릴 도형이 없다.')
  return out.join('')
}

/** Icons.tsx 끝에 붙일 컴포넌트 한 개. ph는 Icons.tsx의 Phosphor 공통 속성(256 격자, 한 색 채움) */
export function renderComponent({ component, prefix, name, jsx }) {
  const set = ALLOWED_SETS[prefix]
  return [
    `/** ${set.title} ${name} (${set.spdx}, Iconify에서 가져옴, 출처는 CREDITS.md) */`,
    `export const ${component} = () => <svg {...ph}>${jsx}</svg>`,
    '',
  ].join('\n')
}

/** CREDITS.md 아이콘 표의 한 줄 */
export function creditRow({ component, prefix, name, date }) {
  const set = ALLOWED_SETS[prefix]
  return `| \`${component}\` | ${set.title} \`${name}\` | ${set.holder} | ${set.spdx}, \`public/licenses/${prefix}-LICENSE.txt\` | ${set.home} | ${date} |`
}
