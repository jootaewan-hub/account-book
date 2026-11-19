import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { difficulty } from '../../../supabase/functions/_shared/recipeClassify'
import type { RecipeV2 } from '../../../supabase/functions/_shared/recipeContract'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { probeObsidian, trashObsidian, writeObsidian } from '../../../tools/recipe-worker/src/export/obsidian'
import { folderPath, mdLink, renderHtml, renderMarkdown, watchUrl } from '../../../tools/recipe-worker/src/export/render'
import gold from '../../../docs/recipes/contract/examples/youtube-AkX6uA4BaDs.json'

function stored(over: Partial<StoredRecipe> = {}): StoredRecipe {
  const r = structuredClone(gold) as unknown as RecipeV2
  const d = difficulty(r)
  return {
    ...r, id: 'rec-1', difficulty: d.level, difficulty_basis: d.basis, memo: null, rating: null, favorite: false,
    saved_at: '2026-11-19T01:00:00Z', updated_at: '2026-11-19T01:00:00Z', ...over,
  }
}

const REL = '레시피/한식/돼지고기/볶음/보통/기사식당 바싹 제육볶음 (셰프호윤 Chef Hoyoon).md'

describe('renderMarkdown', () => {
  const md = renderMarkdown(stored())
  it('첫머리 YAML에 분류 칸이 있고 문자열은 JSON 문자열이다', () => {
    const fm = md.split('---\n')[1]
    for (const k of ['요리종류', '주재료', '세부재료', '조리법', '난이도', '상황', '출처', '채널', '저장한날', '계량도구', '레시피id', '난이도근거', '인분']) {
      expect(fm).toContain(`${k}: `)
    }
    expect(fm).toContain('난이도: "보통"')
    expect(fm).toContain('채널: "셰프호윤 Chef Hoyoon"')
    expect(fm).toContain('저장한날: "2026-11-19"')
    expect(fm).toContain('계량도구: "확인 못 함"')
  })
  it('맨 위 안내, 덧붙인 분량, 시각 링크, 계량 도구', () => {
    expect(md).toContain('> 앱에서 고치면 이 파일은 다시 써져요')
    expect(md).toContain('(덧붙임 1작은술쯤)')
    expect(md).toContain('https://www.youtube.com/watch?v=AkX6uA4BaDs&t=245s')
    expect(md).toContain('계량 도구 확인 못 함')
    expect(md).toContain('기준 2인분(덧붙임, 영상에 인분 없음)')
    expect(md).toContain('말 0:54')
    expect(md).toContain('고친 곳')
  })
  it('자막 문장은 없고 기준 답안의 단계 본문만 있다', () => {
    expect(md).toContain((gold as unknown as RecipeV2).steps[0].body)
    expect(md).not.toMatch(/\bcaption|\basr\b/)
  })
  it('계량스푼이면 ml를, 밥숟가락이면 기준 표시를 붙인다', () => {
    const spoon = renderMarkdown(stored({ measuring_tool: '계량스푼' }))
    expect(spoon).toContain('2큰술 (30ml)')
    const rice = renderMarkdown(stored({ measuring_tool: '밥숟가락' }))
    expect(rice).toContain('· 밥숟가락 기준')
    expect(rice).not.toContain('(30ml)')
  })
  it('인분은 출처 값만, 덧붙인 인분은 따로 적는다', () => {
    const a = renderMarkdown(stored())
    expect(a).toContain('인분: null')
    expect(a).toContain('인분덧붙임: 2')
    const b = renderMarkdown(stored({ servings: { value: 3, origin: 'description' } }))
    expect(b).toContain('인분: 3\n')
    expect(b).toContain('인분덧붙임: null')
  })
  it('링크 글자의 대괄호로 링크를 만들 수 없다', () => {
    const t = renderMarkdown(stored({ source: { ...stored().source, title: 'a](http://x) b [c' } }))
    expect(t).not.toContain('a](http://x)')
    expect(t).toContain('a\\](http://x) b \\[c')
  })
  it('링크 주소의 공백·괄호가 링크 밖으로 나가지 못한다', () => {
    const l = mdLink('x', 'https://e.com/a b)c<d>\n')
    expect(l.match(/\]\(</g)?.length).toBe(1)
    expect(l.match(/>\)/g)?.length).toBe(1)
    expect(l).toBe('[x](<https://e.com/a%20b%29c%3Cd%3E%0A>)')
  })
  it('시각이 유한하지 않으면 &t= 없이 링크한다', () => {
    expect(watchUrl('AkX6uA4BaDs', Number.NaN)).toBe('https://www.youtube.com/watch?v=AkX6uA4BaDs')
    expect(renderMarkdown(stored())).toContain('](<https://www.youtube.com/watch?v=AkX6uA4BaDs&t=245s>)')
  })
  it('제목에 콜론·줄바꿈·---가 있어도 YAML 블록이 깨지지 않는다', () => {
    const t = renderMarkdown(stored({ title: 'a: b\n---\nc', source: { ...stored().source, channel: 'x: "y"\n---' } }))
    const parts = t.split('\n---\n')
    expect(parts[0].startsWith('---\n')).toBe(true)
    expect(t.match(/^---$/gm)?.length).toBe(2)
  })
})

describe('renderHtml', () => {
  it('글자를 이스케이프하고 유튜브 시각 링크만 건다', () => {
    const h = renderHtml(stored({ title: '<script>alert(1)</script>', memo: `"x" & 'y' <b>` }))
    expect(h).not.toContain('<script>')
    expect(h).toContain('&lt;script&gt;')
    expect(h).toContain('&amp;')
    expect(h).toContain('&quot;x&quot;')
    expect(h).toContain('&#39;y&#39;')
    expect(h).toContain('https://www.youtube.com/watch?v=AkX6uA4BaDs&amp;t=245s')
    const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
    expect(hrefs.length).toBeGreaterThan(0)
    for (const u of hrefs) expect(u.startsWith('https://www.youtube.com/watch?v=AkX6uA4BaDs')).toBe(true)
  })
  it('유튜브가 아니면 링크가 없다', () => {
    const base = stored()
    const h = renderHtml({ ...base, source: { kind: 'web', key: 'web:example.com/x', url: 'https://example.com/x', channel: null } })
    expect(h).not.toContain('<a ')
  })
})

describe('writeObsidian / trashObsidian', () => {
  let vault: string
  beforeEach(async () => { vault = await mkdtemp(join(tmpdir(), 'vault-')) })
  afterEach(async () => { await rm(vault, { recursive: true, force: true }) })

  it('분류 폴더 아래에 쓴다', async () => {
    const p = await writeObsidian(vault, stored(), null)
    expect(p).toBe(REL)
    expect(await readFile(join(vault, p), 'utf8')).toContain('레시피id: "rec-1"')
    expect((await readdir(join(vault, '레시피/한식/돼지고기/볶음/보통'))).every((f) => !f.endsWith('.tmp'))).toBe(true)
  })
  it('분류를 바꿔 다시 쓰면 옛 파일이 없어지고 새 자리에 하나', async () => {
    const first = await writeObsidian(vault, stored(), null)
    const next = await writeObsidian(vault, stored({ difficulty: '어려움' }), first)
    expect(next).toBe(REL.replace('/보통/', '/어려움/'))
    await expect(stat(join(vault, first))).rejects.toThrow()
    await expect(stat(join(vault, '레시피/한식/돼지고기/볶음/보통'))).rejects.toThrow()
    expect(await readFile(join(vault, next), 'utf8')).toContain('난이도: "어려움"')
  })
  it('옛 파일이 이미 없으면 새 파일만 쓴다', async () => {
    const p = await writeObsidian(vault, stored(), '레시피/없는/파일.md')
    expect(p).toBe(REL)
  })
  it('같은 제목의 다른 레시피는 이름 뒤에 영상 id 앞 5글자를 붙인다', async () => {
    await writeObsidian(vault, stored(), null)
    const other = stored({ id: 'rec-2', source: { ...stored().source, key: 'youtube:AkX6uZZZZZZ' } })
    const p = await writeObsidian(vault, other, null)
    expect(p).toBe(REL.replace('.md', ' · AkX6u.md'))
    expect(await writeObsidian(vault, stored(), REL)).toBe(REL)
    expect(await readFile(join(vault, REL), 'utf8')).toContain('"rec-1"')
  })
  it('나쁜 옛 경로면 아무것도 쓰기 전에 던진다', async () => {
    await expect(writeObsidian(vault, stored(), '../밖.md')).rejects.toThrow()
    expect(await readdir(vault)).toEqual([])
  })
  it('분류 낱말에 /가 있어도 폴더가 늘지 않는다', async () => {
    const r = stored()
    const p = await writeObsidian(vault, { ...r, tags: { ...r.tags, mains: ['a/b' as never] } }, null)
    expect(p.split('/').length).toBe(6)
    expect(p).toContain('/a·b/')
  })
  it('보관함 밖을 가리키는 옛 경로는 거부한다', async () => {
    await expect(writeObsidian(vault, stored(), '../밖.md')).rejects.toThrow()
  })
  it('점뿐인 제목이어도 보관함 밖으로 나가지 않는다', async () => {
    const p = await writeObsidian(vault, stored({ title: '..', source: { ...stored().source, channel: null } }), null)
    expect(p.startsWith('레시피/')).toBe(true)
    expect(p).not.toContain('..')
  })
  it('trashObsidian은 .trash/로 옮기고 이름이 겹치면 번호를 붙인다', async () => {
    const p = await writeObsidian(vault, stored(), null)
    await trashObsidian(vault, p, 'rec-1')
    const name = REL.split('/').pop() as string
    expect(await readdir(join(vault, '.trash'))).toEqual([name])
    await expect(stat(join(vault, p))).rejects.toThrow()
    const p2 = await writeObsidian(vault, stored(), null)
    await trashObsidian(vault, p2, 'rec-1')
    expect((await readdir(join(vault, '.trash'))).length).toBe(2)
    await expect(trashObsidian(vault, '../x.md', 'rec-1')).rejects.toThrow()
    await trashObsidian(vault, '레시피/없음.md', 'rec-1')
  })
  it('trashObsidian은 그 레시피의 글(레시피id가 같은 파일)만 옮기고, 다른 노트는 그대로 둔다(M4)', async () => {
    await mkdir(join(vault, '일기'), { recursive: true })
    await writeFile(join(vault, '일기', '오늘.md'), '# 오늘\n내 노트')
    await trashObsidian(vault, '일기/오늘.md', 'rec-1')
    expect(await readFile(join(vault, '일기', '오늘.md'), 'utf8')).toBe('# 오늘\n내 노트')
    const p = await writeObsidian(vault, stored(), null)
    await trashObsidian(vault, p, 'rec-other')
    expect(await stat(join(vault, p))).toBeTruthy()
  })
})

describe('probeObsidian', () => {
  it('보관함에 시험 파일을 쓰고 지우며 흔적이 없다', async () => {
    const d = await mkdtemp(join(tmpdir(), 'probe-'))
    try {
      await probeObsidian(d, () => 42)
      expect(await readdir(d)).toEqual([])
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  })
  it('없는 폴더면 실패한다(폴더를 새로 만들지 않는다)', async () => {
    const d = await mkdtemp(join(tmpdir(), 'probe-'))
    try {
      await expect(probeObsidian(join(d, 'nope'))).rejects.toThrow()
      expect(await readdir(d)).toEqual([])
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  })
  it('바로 가기(심볼릭 링크)여도 실제 폴더 안에만 쓰고 임시 파일을 남기지 않는다', async () => {
    const d = await mkdtemp(join(tmpdir(), 'probe-'))
    try {
      await mkdir(join(d, 'real'))
      await symlink(join(d, 'real'), join(d, 'link'))
      await probeObsidian(join(d, 'link'))
      expect(await readdir(join(d, 'real'))).toEqual([])
    } finally {
      await rm(d, { recursive: true, force: true })
    }
  })
  it('쓸 수 없는 폴더면 실패하고 임시 파일을 남기지 않는다', async () => {
    const d = await mkdtemp(join(tmpdir(), 'probe-'))
    try {
      await chmod(d, 0o500)
      await expect(probeObsidian(d)).rejects.toThrow()
      await chmod(d, 0o700)
      expect(await readdir(d)).toEqual([])
    } finally {
      await chmod(d, 0o700).catch(() => {})
      await rm(d, { recursive: true, force: true })
    }
  })
})

describe('난이도를 정하지 않은 레시피의 사본(I2)', () => {
  let dir = ''
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vault-null-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('보관 자리는 "난이도 미정" 폴더, 머리는 난이도 null, 쓰기는 실패하지 않는다', async () => {
    const r = stored({ difficulty: null, difficulty_basis: null })
    expect(folderPath(r).at(-1)).toBe('난이도 미정')
    const p = await writeObsidian(dir, r, null)
    expect(p.split('/')).toContain('난이도 미정')
    const md = await readFile(join(dir, p), 'utf8')
    expect(md).toMatch(/^난이도: null$/m)
    expect(renderHtml(r)).toContain('<h1>')
  })
})

describe('영상에서 온 글이 마크다운·HTML로 읽히지 않는다(M5)', () => {
  it('< > & [ ]를 막아 쓴다(밖의 그림·틀을 불러오지 않게)', () => {
    const r = stored()
    r.summary = '<img src="https://evil.example/a.png"> & <iframe src="https://evil.example"></iframe> ![[x]] ![a](https://evil.example/b.png)'
    const md = renderMarkdown(r)
    const line = md.split('\n').find((l) => l.includes('evil.example'))!
    expect(line).toContain('\\<img')
    expect(line).toContain('\\<iframe')
    expect(line).toContain('\\&')
    expect(line).toContain('!\\[\\[x\\]\\]')
    expect(line).not.toMatch(/(^|[^\\])<img/)
    expect(line).not.toMatch(/(^|[^\\])!\[/)
  })
})
