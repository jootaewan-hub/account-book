import { execFile } from 'node:child_process'

export type RunResult = { stdout: Buffer }
/** 외부 프로그램을 쉘 없이(인자 배열로) 돌린다. 실패하면 stderr를 담은 오류를 던지며, 그 글은 호출한 쪽이 한국어 까닭으로 바꾼 뒤 버린다. */
export type Runner = (file: string, args: string[]) => Promise<RunResult>

export const defaultRun: Runner = (file, args) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error('실행 실패'), { stderr: stderr.toString('utf8').slice(-4000) }))
        else resolve({ stdout })
      },
    )
    child.stdin?.end()
  })

export const errText = (e: unknown): string =>
  typeof e === 'object' && e !== null && 'stderr' in e ? String((e as { stderr: unknown }).stderr) : ''
