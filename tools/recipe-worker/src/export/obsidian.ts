// 옵시디언 보관함에 레시피 글을 쓰고, 분류가 바뀌면 옮기고, 지우면 .trash/로 보낸다. 쓰기는 모두 임시 파일 → 이름 바꾸기.
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileTitle, folderPath, renderMarkdown, videoId, type StoredRecipe } from './render.ts'

const MAX_NAME = 80

/** 점·공백뿐인 이름은 "레시피"로, 제어문자는 공백으로 바꾼다 */
function safeName(s: string): string {
  const t = s.replace(/[/:\\?*"<>|]/g, '·').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return /^[.\s]*$/.test(t) ? '레시피' : t
}

function inside(vault: string, p: string): string {
  const root = resolve(vault)
  const full = resolve(root, p)
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`보관함 밖의 경로예요: ${p}`)
  if (full === root) throw new Error('보관함 자체는 쓸 수 없어요')
  return full
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function recipeIdOf(file: string): Promise<string | null> {
  try {
    const head = (await readFile(file, 'utf8')).split('\n', 40)
    for (const line of head) {
      const m = /^레시피id: (".*")\s*$/.exec(line)
      if (m) return JSON.parse(m[1]) as string
    }
  } catch {
    // 읽지 못하면 다른 글로 본다
  }
  return null
}

async function atomicWrite(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

async function pruneEmpty(vault: string, dir: string): Promise<void> {
  const root = resolve(vault)
  let d = resolve(dir)
  while (d.startsWith(root + sep)) {
    try {
      await rmdir(d)
    } catch {
      return
    }
    d = dirname(d)
  }
}

const rel = (vault: string, full: string): string => relative(resolve(vault), full).split(sep).join('/')

export async function writeObsidian(vaultDir: string, r: StoredRecipe, prevPath: string | null): Promise<string> {
  const prev = prevPath ? inside(vaultDir, prevPath) : null
  const dirs = folderPath(r).map(safeName)
  const name = safeName(fileTitle(r)).slice(0, MAX_NAME).trim()
  let target = inside(vaultDir, join(...dirs, `${name}.md`))

  if (await exists(target)) {
    const owner = await recipeIdOf(target)
    if (owner !== r.id) {
      const tag = (videoId(r) ?? r.id).slice(0, 5)
      for (let n = 1; ; n++) {
        const candidate = inside(vaultDir, join(...dirs, `${name} · ${tag}${n > 1 ? ` ${n}` : ''}.md`))
        if (!(await exists(candidate)) || (await recipeIdOf(candidate)) === r.id) {
          target = candidate
          break
        }
      }
    }
  }

  await atomicWrite(target, renderMarkdown(r))

  if (prev && prev !== target) {
    if ((await exists(prev)) && (await recipeIdOf(prev)) === r.id) {
      await unlink(prev)
      await pruneEmpty(vaultDir, dirname(prev))
    }
  }
  return rel(vaultDir, target)
}

export async function trashObsidian(vaultDir: string, relPath: string): Promise<void> {
  const from = inside(vaultDir, relPath)
  if (!(await exists(from))) return
  const trash = inside(vaultDir, '.trash')
  await mkdir(trash, { recursive: true })
  const base = basename(from)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let to = join(trash, base)
  for (let n = 2; await exists(to); n++) to = join(trash, `${stem} ${n}${ext}`)
  await rename(from, to)
  await pruneEmpty(vaultDir, dirname(from))
}
