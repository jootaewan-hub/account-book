import { useEffect, useRef, useState } from 'react'
import { friendlyError } from '../lib/api'
import { won } from '../lib/format'
import { cropImage, fileToJpeg, type PreparedImage } from '../lib/image'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import {
  analyze, canSplit, entryDrafts, isProductLine, itemsSum, markRepeats, modelLabel, saveDraft, SmartError,
  type AnalyzeBody, type CheckedEntry, type Draft, type DraftContext,
} from '../lib/smart'
import type { Category, Transaction, TxType } from '../lib/types'
import { defaultScope } from './EntrySheet'
import { ItemInfo } from './ItemInfo'
import { PlatformInput } from './PlatformInput'
import { Sheet } from './Sheet'

export type SmartMode = 'text' | 'photo' | 'shop'

interface Props {
  open: boolean
  mode: SmartMode
  today: string
  householdId: string
  lookup: Lookup
  categories: Category[]
  existing: Transaction[]
  onSaved: (count: number, lastDate: string) => Promise<void>
  onManual: () => void
  onClose: () => void
}

type Stage = 'input' | 'loading' | 'review'

const MAX_PHOTOS = 5
const MAX_TOTAL_CHARS = 14_000_000 // 서버(extract.ts MAX_TOTAL_IMAGE_CHARS)와 같은 값
const SAMPLE = '[Web발신]\n신한카드(1234)승인\n홍*동\n12,400원 일시불\n10/13 18:42 이마트24\n누적1,234,560원'
const TITLE: Record<SmartMode, string> = { text: '문자로 입력', photo: '영수증으로 입력', shop: '쇼핑 주문으로 입력' }

/** 분석 결과 한 건(주문·영수증)과 상품별로 나눠 저장할지 */
interface Group {
  index: number
  entry: CheckedEntry
  split: boolean
}

/** 초안 key의 앞 숫자가 분석 결과 번호다 ('2', '2-0', '2-x0') */
const groupOf = (d: Draft) => Number(d.key.split('-')[0])
type Photo = { blob: Blob; url: string }

export function SmartSheet({ open, mode, today, householdId, lookup, categories, existing, onSaved, onManual, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('input')
  const [text, setText] = useState('')
  const [images, setImages] = useState<PreparedImage[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  // 잘라 둔 상품 사진: '내역번호:품목번호' → 사진. 나누기·합치기를 바꿔도 다시 자르지 않는다
  const photos = useRef(new Map<string, Photo>())
  const [note, setNote] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setStage('input'); setText(''); setDrafts([]); setGroups([]); setNote(null); setModel(null); setErr(''); setBusy(false); setPreparing(false)
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.preview)); return [] })
  }, [open, mode])

  async function run(body: AnalyzeBody, imgs: PreparedImage[] = []) {
    setStage('loading'); setErr('')
    try {
      const res = await analyze(body)
      // 상품 사진: 모델이 알려 준 영역을 원본에서 잘라 둔다 (실패하면 사진 없이)
      photos.current = new Map()
      for (const [i, e] of res.entries.entries()) {
        for (const [j, it] of e.items.entries()) {
          const box = it.image_box
          const src = box ? imgs[box.image - 1] : undefined
          if (!box || !src) continue
          try {
            const blob = await cropImage(src.blob, box)
            photos.current.set(`${i}:${j}`, { blob, url: URL.createObjectURL(blob) })
          } catch { /* 사진 없이 */ }
        }
      }
      // 상품이 두 개 이상인 주문은 상품마다 내역 하나로 나눈다
      const gs = res.entries.map((entry, index) => ({ index, entry, split: canSplit(entry) }))
      const ds = markRepeats(gs.flatMap((g) => withPhotos(entryDrafts(g.entry, g.index, draftContext(), g.split))))
      setGroups(gs); setDrafts(ds); setNote(res.note); setModel(modelLabel(res.model))
      if (!ds.length) { setErr(res.note ?? '거래 내역을 찾지 못했어요.'); setStage('input'); return }
      setStage('review')
    } catch (e) {
      setErr(e instanceof SmartError ? e.message : friendlyError(e)); setStage('input')
    }
  }

  function draftContext(): DraftContext {
    return { today, methods: [], categories, existing, fallbackMethodId: null, fallbackScope: defaultScope(lookup) }
  }

  function withPhotos(ds: Draft[]): Draft[] {
    return ds.map((d) => ({ ...d, items: d.items.map((it) => ({ ...it, photo: it.src ? photos.current.get(it.src) ?? null : null })) }))
  }

  // 한 주문을 상품별로 나누기 ↔ 한 내역으로 합치기 (그 주문의 초안은 새로 만든다)
  function toggleSplit(index: number) {
    const g = groups.find((x) => x.index === index)
    if (!g) return
    const split = !g.split
    const fresh = withPhotos(entryDrafts(g.entry, index, draftContext(), split))
    setGroups((gs) => gs.map((x) => (x.index === index ? { ...x, split } : x)))
    setDrafts((ds) => {
      const before = ds.filter((d) => groupOf(d) < index)
      return [...before, ...markRepeats(fresh, before), ...ds.filter((d) => groupOf(d) > index)]
    })
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) setText(t)
      else setErr('클립보드가 비어 있어요.')
    } catch {
      setErr('아래 칸을 길게 눌러 붙여넣어 주세요.')
    }
  }

  // 사진은 바로 분석하지 않고 모은다: 카메라로 한 장씩 찍거나, 앨범에서 여러 장을 여러 번에 나눠 골라도 된다
  async function addFiles(list: FileList | null) {
    const files = [...(list ?? [])]
    if (!files.length) return
    const room = MAX_PHOTOS - images.length
    if (room <= 0) return setErr(`사진은 최대 ${MAX_PHOTOS}장까지예요.`)
    setErr(''); setPreparing(true)
    const added: PreparedImage[] = []
    let failed = 0
    // 큰 사진 여러 장을 한꺼번에 풀면 아이폰 메모리가 모자랄 수 있어 한 장씩 처리한다
    for (const f of files.slice(0, room)) {
      try { added.push(await fileToJpeg(f)) } catch { failed++ }
    }
    setImages((prev) => [...prev, ...added])
    setPreparing(false)
    if (files.length > room) setErr(`사진은 최대 ${MAX_PHOTOS}장까지라 ${room}장만 넣었어요.`)
    else if (failed) setErr(`${failed}장은 읽지 못했어요. 다른 사진으로 해 보세요.`)
  }

  function removeImage(i: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, j) => j !== i)
    })
    setErr('')
  }

  async function analyzePhotos() {
    if (!images.length) return
    if (images.reduce((s, im) => s + im.data.length, 0) > MAX_TOTAL_CHARS) return setErr('사진이 너무 커요. 장수를 줄여 주세요.')
    await run({
      kind: 'image', mode: mode === 'shop' ? 'shop' : 'receipt', today,
      images: images.map(({ media_type, data, width, height }) => ({ media_type, data, width, height })),
    }, images)
  }

  function patch(key: string, p: Partial<Draft>) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)))
  }

  const chosen = drafts.filter((d) => d.include)

  async function saveAll() {
    const bad = chosen.find((d) => !d.amount || !d.date || !d.category_id)
    if (bad) return setErr(!bad.category_id ? '분류를 골라 주세요.' : '금액과 날짜를 확인해 주세요.')
    setBusy(true); setErr('')
    let saved = 0
    try {
      for (const d of chosen) {
        await saveDraft(householdId, d, mode === 'text' ? 'text' : 'photo')
        saved++
        patch(d.key, { include: false })
      }
      await onSaved(saved, chosen[chosen.length - 1].date)
    } catch (e) {
      setErr(`${saved}건 저장 후 멈췄어요: ${friendlyError(e)}`); setBusy(false)
    }
  }

  const previews = images.length > 0 && (
    <div className="smart-previews">{images.map((im) => <img key={im.preview} src={im.preview} alt="고른 사진" />)}</div>
  )

  return (
    <Sheet open={open} title={TITLE[mode]} onClose={onClose}>
      {stage === 'input' && mode === 'text' && (
        <>
          <p className="note">카드 승인 문자, 카카오톡 알림톡, 은행 입금 알림을 그대로 붙여넣으세요. 여러 건을 한꺼번에 넣어도 됩니다.</p>
          <button className="ghost" onClick={pasteFromClipboard}>클립보드에서 붙여넣기</button>
          <textarea className="input smart-text" aria-label="붙여넣을 문자" placeholder={SAMPLE} value={text}
            maxLength={6000} onChange={(e) => setText(e.target.value)} />
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={!text.trim()} onClick={() => run({ kind: 'text', text, today })}>분석하기</button>
        </>
      )}

      {stage === 'input' && mode !== 'text' && (
        <>
          <p className="note">
            {mode === 'shop'
              ? '쿠팡·오늘의집·컬리·네이버페이·스마트스토어의 주문·결제 내역 화면을 캡처해서 고르세요. 상품 이름·수량·금액과 상품 사진까지 함께 저장합니다. 한 주문이 길면 이어서 찍은 캡처를 모두 넣으세요. 최대 5장, 여러 번에 나눠 넣어도 됩니다.'
              : '종이 영수증, 카드앱 결제 화면, 배달 주문내역을 찍거나 캡처해서 고르세요. 사진은 최대 5장까지 모아서 한 번에 분석합니다. 여러 번에 나눠 넣어도 됩니다.'}
          </p>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
          {images.length > 0 && (
            <div className="smart-previews" aria-label={`고른 사진 ${images.length}장`}>
              {images.map((im, i) => (
                <div key={im.preview} className="pv">
                  <img src={im.preview} alt={`고른 사진 ${i + 1}`} />
                  <button className="pv-x" onClick={() => removeImage(i)} aria-label={`사진 ${i + 1} 빼기`}>×</button>
                </div>
              ))}
            </div>
          )}
          <p className="err" role="alert">{err}</p>
          {images.length === 0 ? (
            <button className="primary" disabled={preparing} onClick={() => fileRef.current?.click()}>
              {preparing ? '사진 준비 중…' : mode === 'shop' ? '주문내역 캡처 고르기' : '사진 고르기 · 찍기'}
            </button>
          ) : (
            <>
              <button className="primary" disabled={preparing} onClick={() => void analyzePhotos()}>
                {preparing ? '사진 준비 중…' : `사진 ${images.length}장 분석하기`}
              </button>
              {images.length < MAX_PHOTOS && (
                <button className="ghost" disabled={preparing} onClick={() => fileRef.current?.click()}>
                  사진 더 넣기 ({images.length}/{MAX_PHOTOS})
                </button>
              )}
            </>
          )}
        </>
      )}

      {stage === 'loading' && (
        <div className="smart-loading" role="status">
          {previews}
          <p className="lead">읽는 중이에요… {mode === 'shop' ? '상품 사진까지 찾느라 20~40초쯤 걸려요.' : '보통 5~15초 걸려요.'}</p>
        </div>
      )}

      {stage === 'review' && (
        <>
          {note && <p className="note">{note}</p>}
          {groups.map((g) => (
            <div key={g.index} className="draft-group">
              {canSplit(g.entry) && (
                <label className="check split-toggle">
                  <input type="checkbox" checked={g.split} onChange={() => toggleSplit(g.index)} />
                  <span>
                    {g.entry.platform || g.entry.merchant || '주문'} {won(g.entry.amount)}원 · 상품 {g.entry.items.filter(isProductLine).length}개를
                    {' '}{g.split ? '하나씩 따로 저장' : '한 내역으로 저장'} (눌러서 바꾸기)
                  </span>
                </label>
              )}
              {drafts.filter((d) => groupOf(d) === g.index).map((d) => (
                <DraftCard key={d.key} d={d} categories={categories} onChange={(p) => patch(d.key, p)} />
              ))}
            </div>
          ))}
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={busy || !chosen.length} onClick={saveAll}>
            {busy ? '저장 중…' : chosen.length ? `${chosen.length}건 저장` : '저장할 내역을 고르세요'}
          </button>
          <button className="ghost" disabled={busy} onClick={() => { setStage('input'); setErr('') }}>다시 하기</button>
          {model && <p className="tx-meta">{model}로 읽었어요</p>}
        </>
      )}

      {stage !== 'loading' && <button className="link-btn" onClick={onManual}>직접 입력으로 바꾸기</button>}
    </Sheet>
  )
}

function DraftCard({ d, categories, onChange }: {
  d: Draft
  categories: Category[]
  onChange: (p: Partial<Draft>) => void
}) {
  const sum = itemsSum(d.items)
  const cats = categories.filter((c) => c.type === d.type)
  const removePhoto = (i: number) =>
    onChange({ items: d.items.map((it, j) => (j === i ? { ...it, photo: null } : it)) })
  return (
    <div className={`card draft${d.include ? '' : ' off'}`}>
      <label className="draft-head">
        <input type="checkbox" checked={d.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <span>{d.include ? '저장' : '빼기'}</span>
        <b className={`num ${d.type === 'income' ? 'inc' : 'exp'}`}>{d.type === 'income' ? '+' : '-'}{won(d.amount)}원</b>
      </label>
      {d.warnings.map((w) => <p key={w} className="banner">{w}</p>)}
      <div className="seg" role="group" aria-label="구분">
        {(['expense', 'income'] as TxType[]).map((t) => (
          <button key={t} aria-pressed={d.type === t} onClick={() => onChange({ type: t, category_id: null })}>{t === 'expense' ? '지출' : '수입'}</button>
        ))}
      </div>
      <div className="field">
        <label>내용</label>
        <input className="input" value={d.title} maxLength={60} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="field">
        <label>플랫폼</label>
        <PlatformInput value={d.platform ?? ''} onChange={(v) => onChange({ platform: v })} />
      </div>
      <div className="row2">
        <div className="field">
          <label>금액</label>
          <input className="input num" inputMode="numeric" value={d.amount ? String(d.amount) : ''}
            onChange={(e) => onChange({ amount: Number(e.target.value.replace(/\D/g, '').slice(0, 10)) || 0 })} />
        </div>
        <div className="field">
          <label>날짜</label>
          <input type="date" className="input date-input" value={d.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
      </div>
      {d.memo && <p className="tx-meta">{d.memo}</p>}
      <div className="field">
        <span className="lbl">분류</span>
        <div className="chips">
          {cats.map((c) => (
            <button key={c.id} className="chip" aria-pressed={d.category_id === c.id} onClick={() => onChange({ category_id: c.id })}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="lbl">{d.type === 'income' ? '누구의 수입인가요' : '누구를 위한 지출인가요'}</span>
        <div className="seg" role="group">
          {SCOPES.map((s) => (
            <button key={s} aria-pressed={d.scope === s} onClick={() => onChange({ scope: s })}>{SCOPE_LABEL[s]}</button>
          ))}
        </div>
      </div>
      {d.items.length > 0 && (
        <div className="field">
          <span className="lbl">품목 {d.items.length}개 · 합계 <span className="num">{won(sum)}</span>원</span>
          <ul className="item-list">
            {d.items.map((it, i) => (
              <li key={i}>
                {it.photo
                  ? <button className="thumb-btn" onClick={() => removePhoto(i)} aria-label={`${it.name} 사진 빼기`}>
                      <img className="item-thumb" src={it.photo.url} alt="" /><span className="thumb-x">×</span>
                    </button>
                  : <span className="item-thumb empty" aria-hidden="true" />}
                <ItemInfo it={it} />
                <span className="num">{won(it.amount)}</span>
              </li>
            ))}
          </ul>
          {d.items.some((it) => it.photo) && <span className="tx-meta">사진이 잘못 잘렸으면 사진을 눌러 빼세요.</span>}
        </div>
      )}
    </div>
  )
}
