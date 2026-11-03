// 영수증 사진(D-053): 경로·번호 정리와, 가짜 Supabase로 올리기·되돌리기·receipt_path 적기·쓰지 않는 폴더만 지우기
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  calls: [] as { op: string; args: unknown[] }[],
  /** 경로 → 올리기 실패 */
  failUpload: new Set<string>(),
  /** 폴더 → 파일 이름 */
  files: new Map<string, string[]>(),
  /** receipt_path → 그 폴더를 가리키는 내역 수 */
  refs: new Map<string, number>(),
  updateError: null as string | null,
}))

function fakeStorage(bucket: string) {
  const log = (op: string, ...args: unknown[]) => state.calls.push({ op: `${bucket}.${op}`, args })
  return {
    upload: async (path: string, blob: Blob, opts: unknown) => {
      log('upload', path, blob, opts)
      return state.failUpload.has(path) ? { error: { message: 'boom' } } : { error: null }
    },
    remove: async (paths: string[]) => { log('remove', paths); return { error: null } },
    list: async (folder: string) => { log('list', folder); return { data: (state.files.get(folder) ?? []).map((name) => ({ name })), error: null } },
    download: async (path: string) => { log('download', path); return { data: new Blob([path]), error: null } },
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://x/${p}?t=1` })), error: null }),
  }
}

function fakeTable(table: string) {
  const log = (op: string, ...args: unknown[]) => state.calls.push({ op: `${table}.${op}`, args })
  return {
    update: (patch: unknown) => ({
      in: async (col: string, ids: string[]) => { log('update.in', patch, col, ids); return { error: state.updateError ? { message: state.updateError } : null } },
      eq: async (col: string, v: string) => { log('update.eq', patch, col, v); return { error: state.updateError ? { message: state.updateError } : null } },
    }),
    select: (cols: string) => ({
      eq: (col: string, v: string) => ({
        limit: async () => { log('select', cols, col, v); return { data: Array.from({ length: Math.min(1, state.refs.get(v) ?? 0) }, () => ({ id: 'x' })), error: null } },
      }),
    }),
  }
}

vi.mock('../src/lib/supabase', () => ({
  sb: () => ({ storage: { from: fakeStorage }, from: fakeTable }),
}))

const {
  downloadReceiptImages, listReceiptImages, receiptFolder, receiptImageIndexes, receiptImagePaths, removeReceiptImages, removeUnusedReceiptImages,
  setReceiptPath, signedReceiptUrls, uploadReceiptImages,
} = await import('../src/lib/receiptImages')

const ops = (prefix = '') => state.calls.filter((c) => c.op.startsWith(prefix)).map((c) => [c.op, ...c.args] as unknown[])
const blob = (s: string) => new Blob([s], { type: 'image/jpeg' })

beforeEach(() => {
  state.calls = []
  state.failUpload = new Set()
  state.files = new Map()
  state.refs = new Map()
  state.updateError = null
})

describe('경로', () => {
  it('폴더는 <가구 id>/<내역 id>, 파일은 번호 순(10이 2 뒤), 번호.jpg가 아닌 파일은 뺀다', () => {
    expect(receiptFolder('hh', 'tx')).toBe('hh/tx')
    expect(receiptImagePaths('hh/tx', ['10.jpg', '2.jpg', '1.jpg', '.emptyFolderPlaceholder', 'x.png'])).toEqual(['hh/tx/1.jpg', 'hh/tx/2.jpg', 'hh/tx/10.jpg'])
  })

  it('내역이 읽은 사진 번호: 응답의 images를 범위 안에서 중복 없이 오름차순, 없으면 사진이 한 장일 때만 그 한 장', () => {
    expect(receiptImageIndexes({ images: [3, 2, 2, 9, 0] }, 4)).toEqual([2, 3])
    expect(receiptImageIndexes({}, 1)).toEqual([1])
    expect(receiptImageIndexes({ images: [] }, 1)).toEqual([1])
    expect(receiptImageIndexes({ images: null }, 3)).toEqual([])
    expect(receiptImageIndexes({ images: [7] }, 3)).toEqual([])
  })
})

describe('올리기', () => {
  it('사진을 1.jpg, 2.jpg로 올리고 내역의 receipt_path를 적는다', async () => {
    expect(await uploadReceiptImages('hh/t1', [blob('a'), blob('b')])).toBe(true)
    expect(ops('receipt-images.upload').map((c) => [c[1], (c[3] as { contentType: string }).contentType])).toEqual([['hh/t1/1.jpg', 'image/jpeg'], ['hh/t1/2.jpg', 'image/jpeg']])
    await setReceiptPath(['t1', 't2'], 'hh/t1')
    expect(ops('transactions.update.in')).toEqual([['transactions.update.in', { receipt_path: 'hh/t1' }, 'id', ['t1', 't2']]])
  })

  it('한 장이라도 실패하면 올린 것을 지우고 false(내역은 그대로, receipt_path는 비워 둔다)', async () => {
    state.failUpload.add('hh/t1/2.jpg')
    expect(await uploadReceiptImages('hh/t1', [blob('a'), blob('b'), blob('c')])).toBe(false)
    expect(ops('receipt-images.remove')).toEqual([['receipt-images.remove', ['hh/t1/1.jpg']]])
    expect(ops('receipt-images.upload')).toHaveLength(2) // 3번째는 올리지 않는다
    expect(await uploadReceiptImages('hh/t1', [])).toBe(false)
  })

  it('receipt_path 적기가 실패하면 던진다(부르는 쪽이 알림을 붙인다)', async () => {
    state.updateError = 'permission denied'
    await expect(setReceiptPath(['t1'], 'hh/t1')).rejects.toThrow('permission denied')
    await setReceiptPath([], 'hh/t1') // 빈 목록은 아무것도 안 한다
    expect(ops('transactions.update.in')).toHaveLength(1)
  })
})

describe('보기·내려받기', () => {
  it('폴더의 파일을 번호 순 경로로 돌려주고, 내려받기는 경로마다 blob', async () => {
    state.files.set('hh/t1', ['2.jpg', '1.jpg'])
    expect(await listReceiptImages('hh/t1')).toEqual(['hh/t1/1.jpg', 'hh/t1/2.jpg'])
    expect(await listReceiptImages('hh/none')).toEqual([])
    const blobs = await downloadReceiptImages(['hh/t1/1.jpg', 'hh/t1/2.jpg'])
    expect(await Promise.all(blobs.map((b) => b.text()))).toEqual(['hh/t1/1.jpg', 'hh/t1/2.jpg'])
    const urls = await signedReceiptUrls(['hh/t1/1.jpg'])
    expect(urls.get('hh/t1/1.jpg')).toBe('https://x/hh/t1/1.jpg?t=1')
  })
})

describe('지우기', () => {
  it('사진 지우기: 폴더 파일을 지우고 같은 폴더를 가리키는 내역 모두의 receipt_path를 비운다', async () => {
    state.files.set('hh/t1', ['1.jpg', '2.jpg'])
    await removeReceiptImages('hh/t1')
    expect(ops('receipt-images.remove')).toEqual([['receipt-images.remove', ['hh/t1/1.jpg', 'hh/t1/2.jpg']]])
    expect(ops('transactions.update.eq')).toEqual([['transactions.update.eq', { receipt_path: null }, 'receipt_path', 'hh/t1']])
  })

  it('내역을 지운 뒤: 아직 그 폴더를 가리키는 내역이 있으면 두고, 없을 때만 지운다. 같은 폴더는 한 번만 본다', async () => {
    state.files.set('hh/t1', ['1.jpg'])
    state.files.set('hh/t3', ['1.jpg'])
    state.refs.set('hh/t1', 1) // 나눠 저장한 짝이 남아 있다
    await removeUnusedReceiptImages(['hh/t1', 'hh/t1', null, 'hh/t3', undefined])
    expect(ops('transactions.select').map((c) => c[3])).toEqual(['hh/t1', 'hh/t3'])
    expect(ops('receipt-images.remove')).toEqual([['receipt-images.remove', ['hh/t3/1.jpg']]])
  })
})
