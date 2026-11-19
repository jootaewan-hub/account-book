// 레시피 한 건을 사본 글(마크다운·HTML)로 만든다. 순수 함수. 자막·받아쓰기 원문은 넣지 않는다(단계 본문은 다시 쓴 글).
import { fileTitle, folderPath } from '../../../../supabase/functions/_shared/recipeClassify.ts'
import type { Origin } from '../../../../supabase/functions/_shared/recipeContract.ts'
import type { StoredRecipe } from '../../../../supabase/functions/_shared/recipeStored.ts'
import { unitMl } from '../../../../supabase/functions/_shared/recipeUnits.ts'

export { fileTitle, folderPath }
export type { StoredRecipe }

type Inline = string | { text: string; href: string }
type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'p'; parts: Inline[] }
  | { kind: 'quote'; parts: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; items: Inline[][] }

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function videoId(r: Pick<StoredRecipe, 'source'>): string | null {
  const m = /^youtube(?:_shorts)?:([A-Za-z0-9_-]{6,20})$/.exec(r.source.key)
  return m ? m[1] : null
}

function watchUrl(id: string, t?: number | null): string {
  return `https://www.youtube.com/watch?v=${id}${t != null ? `&t=${Math.max(0, Math.floor(t))}s` : ''}`
}

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function originLabel(origin: Origin | null | undefined, at: number | null | undefined, id: string | null): Inline {
  const names: Record<string, string> = {
    description: '설명란', caption_manual: '작성자 자막', caption_auto: '말', asr: '말', screen: '화면', user: '직접 고침', editor: '덧붙임',
  }
  if (!origin) return '출처 확인 못 함'
  const name = names[origin] ?? origin
  if (at == null || origin === 'description' || origin === 'user' || origin === 'editor') return name
  const text = `${name} ${clock(at)}`
  return id ? { text, href: watchUrl(id, at) } : text
}

function num(n: number): string {
  return String(Number.isInteger(n) ? n : Math.round(n * 100) / 100)
}

function amountText(g: StoredRecipe['ingredients'][number], tool: StoredRecipe['measuring_tool']): string {
  if (g.amount !== null) {
    const ml = unitMl(g.unit, tool ?? '확인 못 함')
    const base = `${num(g.amount)}${g.unit ?? ''}`
    return ml !== null ? `${base} (${num(g.amount * ml)}ml)` : base
  }
  const parts: string[] = []
  if (g.amount_text) parts.push(oneLine(g.amount_text))
  if (g.suggested_amount != null) parts.push(`(덧붙임 ${num(g.suggested_amount)}${g.suggested_unit ?? ''}쯤)`)
  return parts.join(' ')
}

function servingsLine(r: StoredRecipe, id: string | null): Inline[] {
  const s = r.servings
  if (s.value != null) {
    const out: Inline[] = [`인분: ${num(s.value)}인분 (`, originLabel(s.origin, null, id), ')']
    if (s.basis) out.push(` · ${oneLine(s.basis)}`)
    return out
  }
  if (s.suggested != null) {
    const out: Inline[] = [`인분: 기준 ${num(s.suggested)}인분(덧붙임, 영상에 인분 없음)`]
    if (s.basis) out.push(` · ${oneLine(s.basis)}`)
    return out
  }
  return ['인분: 확인 못 함']
}

function toolLine(r: StoredRecipe): string {
  const tool = r.measuring_tool ?? '확인 못 함'
  if (tool === '계량스푼') return '계량 도구: 계량스푼 (큰술 15ml, 작은술 5ml)'
  if (tool === '밥숟가락') return '계량 도구: 밥숟가락 · 밥숟가락 기준으로 적힌 양'
  if (tool === '섞어 씀') return '계량 도구: 섞어 씀 (스푼 크기가 일정하지 않을 수 있어요)'
  return '계량 도구 확인 못 함'
}

function buildBlocks(r: StoredRecipe): Block[] {
  const id = videoId(r)
  const tool = r.measuring_tool ?? '확인 못 함'
  const blocks: Block[] = []
  blocks.push({ kind: 'h1', text: oneLine(r.title) })
  blocks.push({ kind: 'quote', parts: ['앱에서 고치면 이 파일은 다시 써져요'] })

  const src: Inline[] = ['출처: ']
  const label = oneLine(r.source.title ?? r.title) + (r.source.channel ? ` (${oneLine(r.source.channel)})` : '')
  if (id) src.push({ text: label, href: watchUrl(id) })
  else src.push(r.source.url ? `${label} ${r.source.url}` : label)
  blocks.push({ kind: 'p', parts: src })
  if (r.summary) blocks.push({ kind: 'p', parts: [oneLine(r.summary)] })
  blocks.push({ kind: 'p', parts: [toolLine(r)] })
  blocks.push({ kind: 'p', parts: servingsLine(r, id) })

  blocks.push({ kind: 'h2', text: '재료' })
  const sections: string[] = []
  for (const g of r.ingredients) {
    const s = g.section ?? ''
    if (!sections.includes(s)) sections.push(s)
  }
  for (const sec of sections) {
    if (sec) blocks.push({ kind: 'p', parts: [`[${oneLine(sec)}]`] })
    const items = r.ingredients.filter((g) => (g.section ?? '') === sec).map((g) => {
      const row: Inline[] = [oneLine(g.name) + (g.optional ? ' (선택)' : '')]
      const a = amountText(g, tool)
      if (a) row.push(` ${a}`)
      if (g.note) row.push(` · ${oneLine(g.note)}`)
      row.push(' — ', originLabel(g.origin, g.at_seconds, id))
      if (g.needs_review) row.push(' · 확인 필요')
      return row
    })
    blocks.push({ kind: 'ul', items })
  }

  if (r.glossary && r.glossary.length > 0) {
    blocks.push({ kind: 'h2', text: '용어' })
    blocks.push({
      kind: 'ul',
      items: r.glossary.map((t) => [`${oneLine(t.term)} — ${oneLine(t.body)} · `, originLabel(t.origin, t.at_seconds, id)]),
    })
  }

  blocks.push({ kind: 'h2', text: '만드는 순서' })
  blocks.push({
    kind: 'ol',
    items: r.steps.map((s) => {
      const row: Inline[] = [`${oneLine(s.title)}: ${oneLine(s.body)}`]
      if (s.heat) row.push(` · 불: ${oneLine(s.heat)}`)
      if (s.cue) row.push(` · 확인: ${oneLine(s.cue)}`)
      if (s.timer_seconds != null) row.push(` · ${clock(s.timer_seconds)}`)
      if (s.editor_tip) row.push(` · 덧붙임: ${oneLine(s.editor_tip)}`)
      if (s.video_start_seconds != null) {
        row.push(' ')
        const t = `▶ ${clock(s.video_start_seconds)}`
        row.push(id ? { text: t, href: watchUrl(id, s.video_start_seconds) } : t)
      }
      return row
    }),
  })

  if (r.principles && r.principles.length > 0) {
    blocks.push({ kind: 'h2', text: '원리' })
    blocks.push({
      kind: 'ul',
      items: r.principles.map((p) => [`${oneLine(p.title)} — ${oneLine(p.body)} · `, originLabel(p.origin, p.video_start_seconds, id)]),
    })
  }

  if (r.conflicts && r.conflicts.length > 0) {
    blocks.push({ kind: 'h2', text: '말이 다른 곳' })
    blocks.push({
      kind: 'ul',
      items: r.conflicts.map((c) => {
        const row: Inline[] = [`${oneLine(c.about)}: `]
        row.push(originLabel(c.chosen_origin, null, id), `: ${oneLine(c.chosen)} / `)
        row.push(originLabel(c.other_origin, c.video_start_seconds, id), `: ${oneLine(c.other)}`)
        if (c.note) row.push(` · ${oneLine(c.note)}`)
        return row
      }),
    })
  }

  if (r.corrections && r.corrections.length > 0) {
    blocks.push({ kind: 'h2', text: '고친 곳' })
    blocks.push({
      kind: 'ul',
      items: r.corrections.map((c) => [`${oneLine(c.target)}: ${c.before != null ? oneLine(c.before) : '(없음)'} → ${c.after != null ? oneLine(c.after) : '(없앰)'}`]),
    })
  }

  if (r.memo || r.rating != null) {
    blocks.push({ kind: 'h2', text: '내 기록' })
    if (r.rating != null) blocks.push({ kind: 'p', parts: [`별점: ${num(r.rating)} / 5`] })
    if (r.memo) blocks.push({ kind: 'p', parts: [`메모: ${oneLine(r.memo)}`] })
  }
  return blocks
}

const yamlStr = (s: string): string => JSON.stringify(s)
const yamlList = (a: string[]): string => JSON.stringify(a)

export function frontmatter(r: StoredRecipe): string {
  const b = r.difficulty_basis
  const lines = [
    `레시피id: ${yamlStr(r.id)}`,
    `요리종류: ${yamlStr(r.tags.cuisine)}`,
    `주재료: ${yamlList(r.tags.mains)}`,
    `세부재료: ${yamlList(r.tags.main_details)}`,
    `조리법: ${yamlList(r.tags.methods)}`,
    `난이도: ${yamlStr(r.difficulty)}`,
    `난이도근거: ${b ? JSON.stringify({ 필수재료: b.required, 단계: b.steps, 손이많이감: b.heavy }) : 'null'}`,
    `상황: ${yamlList(r.tags.occasions)}`,
    `인분: ${r.servings.value ?? r.servings.suggested ?? 'null'}`,
    `출처: ${yamlStr(r.source.url ?? '')}`,
    `채널: ${yamlStr(r.source.channel ?? '')}`,
    `저장한날: ${yamlStr(r.saved_at.slice(0, 10))}`,
    `계량도구: ${yamlStr(r.measuring_tool ?? '확인 못 함')}`,
  ]
  return `---\n${lines.join('\n')}\n---\n`
}

const mdInline = (parts: Inline[]): string => parts.map((p) => (typeof p === 'string' ? p : `[${p.text}](${p.href})`)).join('')

export function renderMarkdown(r: StoredRecipe): string {
  const out: string[] = [frontmatter(r)]
  for (const b of buildBlocks(r)) {
    if (b.kind === 'h1') out.push(`# ${b.text}\n`)
    else if (b.kind === 'h2') out.push(`## ${b.text}\n`)
    else if (b.kind === 'quote') out.push(`> ${mdInline(b.parts)}\n`)
    else if (b.kind === 'p') out.push(`${mdInline(b.parts)}\n`)
    else out.push(b.items.map((it, i) => `${b.kind === 'ol' ? `${i + 1}.` : '-'} ${mdInline(it)}`).join('\n') + '\n')
  }
  return out.join('\n')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const htmlInline = (parts: Inline[]): string =>
  parts.map((p) => (typeof p === 'string' ? escapeHtml(p) : `<a href="${escapeHtml(p.href)}">${escapeHtml(p.text)}</a>`)).join('')

export function renderHtml(r: StoredRecipe): string {
  const body: string[] = []
  for (const b of buildBlocks(r)) {
    if (b.kind === 'h1') body.push(`<h1>${escapeHtml(b.text)}</h1>`)
    else if (b.kind === 'h2') body.push(`<h2>${escapeHtml(b.text)}</h2>`)
    else if (b.kind === 'quote' || b.kind === 'p') body.push(`<p>${htmlInline(b.parts)}</p>`)
    else body.push(`<${b.kind}>${b.items.map((it) => `<li>${htmlInline(it)}</li>`).join('')}</${b.kind}>`)
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(oneLine(r.title))}</title></head><body>${body.join('\n')}</body></html>`
}
