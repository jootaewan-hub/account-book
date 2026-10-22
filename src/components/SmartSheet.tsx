import { useEffect, useMemo, useRef, useState } from 'react'
import { linkGroceryItems, loadReceiptGroceryItems, type ReceiptGroceryItem } from '../grocery/lib/ledgerLink'
import { linksByTx, matchReceipt, receiptLines } from '../grocery/lib/purchase'
import { fetchFuelFills, fetchItemHistory, friendlyError, generateRecurring } from '../lib/api'
import { won } from '../lib/format'
import { fuelDelta, fuelKind } from '../lib/fuel'
import { compareTrip, GROCERY_CATEGORY_NAMES, isGroceryEntry, type CompareLine, type CompareResult } from '../lib/shopCompare'
import { cropImage, fileToJpeg, type PreparedImage } from '../lib/image'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import {
  analyze, analyzeBill, analyzeImages, BATCH_SIZE, canSplit, entryDrafts, fuelComplete, isProductLine, itemsSum, markRepeats, modelLabel, parseLiters, parsePricePerLiter, saveDraft, SmartError,
  type AnalyzeResult, type CheckedBill, type CheckedEntry, type Draft, type DraftContext, type DraftFuel,
} from '../lib/smart'
import { BillReview } from './BillReview'
import { PriceDelta } from './PriceDelta'
import { ShopCompareCard } from './ShopCompareCard'
import type { Category, FuelFill, Transaction, TxType } from '../lib/types'
import { defaultScope } from '../lib/localPrefs'
import { GroceryMatchCard } from './GroceryMatchCard'
import { InstallmentPicker } from './InstallmentPicker'
import { ItemInfo } from './ItemInfo'
import { PlatformInput } from './PlatformInput'
import { Sheet } from './Sheet'

export type SmartMode = 'text' | 'photo' | 'shop' | 'bill'

interface Props {
  open: boolean
  mode: SmartMode
  today: string
  householdId: string
  lookup: Lookup
  categories: Category[]
  existing: Transaction[]
  onSaved: (count: number, lastDate: string, msg?: string) => Promise<void>
  onManual: () => void
  onClose: () => void
}

type Stage = 'input' | 'loading' | 'review'

const MAX_PHOTOS = 20
const SAMPLE = '[Web발신]\n신한카드(1234)승인\n홍*동\n12,400원 일시불\n10/13 18:42 이마트24\n누적1,234,560원'
const TITLE: Record<SmartMode, string> = { text: '문자로 입력', photo: '영수증으로 입력', shop: '쇼핑 주문으로 입력', bill: '관리비 고지서로 입력' }

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
  const [progress, setProgress] = useState('')
  const [bill, setBill] = useState<CheckedBill | null>(null)
  // 영수증·쇼핑 주문을 장보기 품목과 맞춘다(D-011 길 ①). 장보기를 못 불러와도 입력은 그대로 된다
  const [grocery, setGrocery] = useState<ReceiptGroceryItem[]>([])
  const [picks, setPicks] = useState<ReadonlyMap<string, string>>(new Map())
  const lines = useMemo(() => receiptLines(drafts), [drafts])
  const suggested = useMemo(() => matchReceipt(lines, grocery.filter((g) => !g.linked)), [lines, grocery])
  const linkedMatches = useMemo(() => matchReceipt(lines, grocery.filter((g) => g.linked)), [lines, grocery])
  // 제안이 바뀔 때만 체크를 다시 채운다(초안 이름·금액을 고쳐도 사용자가 푼 체크는 그대로)
  const suggestKey = [...suggested].map(([id, key]) => `${id}>${key}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPicks(suggested) }, [suggestKey])
  const withGrocery = mode === 'photo' || mode === 'shop'
  useEffect(() => {
    if (!open || stage !== 'review' || !withGrocery) return
    let alive = true
    loadReceiptGroceryItems(householdId).then((g) => { if (alive) setGrocery(g) }, () => { if (alive) setGrocery([]) })
    return () => { alive = false }
  }, [open, stage, withGrocery, householdId])
  // 주유 영수증이면 지난 주유 기록을 읽어 리터당 가격을 견준다(못 읽어도 입력은 그대로)
  const [fills, setFills] = useState<FuelFill[]>([])
  const hasFuel = drafts.some((d) => d.fuel)
  useEffect(() => {
    if (!open || stage !== 'review' || !hasFuel) return
    let alive = true
    fetchFuelFills(householdId).then((f) => { if (alive) setFills(f) }, () => { if (alive) setFills([]) })
    return () => { alive = false }
  }, [open, stage, hasFuel, householdId])
  // 이번 장보기 살펴보기(설계 2026-10-21 3-2): 최근 1년 품목 줄을 읽어 화면에서 견준다. 못 읽어도 입력·저장은 그대로
  const [history, setHistory] = useState<{ rows: Transaction[]; loading: boolean; error: string | null }>({ rows: [], loading: false, error: null })
  useEffect(() => {
    if (!open || stage !== 'review' || !withGrocery) return
    let alive = true
    setHistory({ rows: [], loading: true, error: null })
    const from = new Date(Date.parse(`${today}T00:00:00`) - 365 * 86_400_000)
    const fromText = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
    fetchItemHistory(householdId, fromText)
      .then((rows) => { if (alive) setHistory({ rows, loading: false, error: null }) })
      .catch((e) => { if (alive) setHistory({ rows: [], loading: false, error: friendlyError(e) }) })
    return () => { alive = false }
  }, [open, stage, withGrocery, householdId, today])
  const groceryCategoryIds = useMemo(() => new Set(categories.filter((c) => c.type === 'expense' && GROCERY_CATEGORY_NAMES.has(c.name)).map((c) => c.id)), [categories])
  // 상품 줄 key → 맞춰진 장보기 품목 이름(체크한 것과 이미 넣은 품목의 같은 이름)
  const groceryNameOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const [id, key] of [...picks, ...linkedMatches]) { const g = grocery.find((x) => x.id === id); if (g) m.set(key, g.name) }
    return m
  }, [picks, linkedMatches, grocery])
  // 묶음(영수증 한 장)마다 살펴보기 결과. 글자를 칠 때마다 다시 계산하지 않게 초안·기록·연결이 바뀔 때만 계산한다
  const compareByGroup = useMemo(() => {
    const out = new Map<number, CompareResult>()
    for (const g of groups) {
      const mine = drafts.filter((d) => groupOf(d) === g.index)
      // 비교 금액은 저장되는 품목 줄 금액(it.amount)과 같은 기준이다(나눈 초안의 d.amount는 할인을 뺀 값이라 지난 기록과 어긋난다)
      const lines: CompareLine[] = mine.filter((d) => d.include && d.type === 'expense').flatMap((d) =>
        d.items.map((it, j) => ({ it, j })).filter(({ it }) => isProductLine(it)).map(({ it, j }) => {
          const key = `${d.key}:${j}`
          return { key, name: it.name, quantity: it.quantity, unitPrice: it.unit_price, amount: it.amount,
            packSize: it.pack_size, packUnit: it.pack_unit, groceryName: groceryNameOf.get(key) ?? null }
        }))
      if (!lines.length) continue
      const names = mine.map((d) => categories.find((c) => c.id === d.category_id)?.name ?? null)
      if (!isGroceryEntry(names.find((n) => n !== null && GROCERY_CATEGORY_NAMES.has(n)) ?? names[0] ?? null, lines)) continue
      out.set(g.index, compareTrip(lines, history.rows, g.entry.date ?? today, g.entry.amount, groceryCategoryIds))
    }
    return out
  }, [groups, drafts, history.rows, groceryNameOf, groceryCategoryIds, categories, today])
  // 관리비 고지서는 한 장의 여러 부분이라 한 번에 보낸다
  const maxPhotos = mode === 'bill' ? BATCH_SIZE : MAX_PHOTOS
  const fileRef = useRef<HTMLInputElement>(null)
  // 분석 요청 번호. 시트를 닫았다 다시 열면 번호가 바뀌어, 늦게 끝난 이전 분석 결과는 버린다
  const reqRef = useRef(0)

  function dropPhotos() {
    for (const p of photos.current.values()) URL.revokeObjectURL(p.url)
    photos.current = new Map()
  }

  useEffect(() => {
    if (!open) return
    reqRef.current++
    dropPhotos()
    setStage('input'); setText(''); setDrafts([]); setGroups([]); setNote(null); setModel(null); setErr(''); setBusy(false); setPreparing(false); setProgress(''); setBill(null)
    setGrocery([]); setFills([]); setHistory({ rows: [], loading: false, error: null })
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.preview)); return [] })
  }, [open, mode])

  async function run(request: () => Promise<AnalyzeResult & { failed?: { from: number; to: number; message: string }[] }>, imgs: PreparedImage[] = []) {
    const id = ++reqRef.current
    setStage('loading'); setErr(''); setProgress('')
    try {
      const res = await request()
      if (id !== reqRef.current) return
      // 상품 사진: 모델이 알려 준 영역을 원본에서 잘라 둔다 (실패하면 사진 없이)
      dropPhotos()
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
      const failed = (res.failed ?? []).map((f) => `사진 ${f.from}~${f.to}번은 읽지 못했어요 (${f.message}). 그 사진만 다시 넣어 주세요.`).join('\n')
      if (!ds.length) { setErr(failed || res.note || '거래 내역을 찾지 못했어요.'); setStage('input'); return }
      setErr(failed)
      setStage('review')
    } catch (e) {
      if (id !== reqRef.current) return
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
    const room = maxPhotos - images.length
    if (room <= 0) return setErr(`사진은 최대 ${maxPhotos}장까지예요.`)
    setErr(''); setPreparing(true)
    const added: PreparedImage[] = []
    let failed = 0
    // 큰 사진 여러 장을 한꺼번에 풀면 아이폰 메모리가 모자랄 수 있어 한 장씩 처리한다
    for (const f of files.slice(0, room)) {
      try { added.push(await fileToJpeg(f)) } catch { failed++ }
    }
    setImages((prev) => [...prev, ...added])
    setPreparing(false)
    if (files.length > room) setErr(`사진은 최대 ${maxPhotos}장까지라 ${room}장만 넣었어요.`)
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
    const payload = images.map(({ media_type, data, width, height }) => ({ media_type, data, width, height }))
    if (mode === 'bill') {
      const id = ++reqRef.current
      setStage('loading'); setErr('')
      try {
        const res = await analyzeBill(payload, today)
        if (id !== reqRef.current) return
        setBill(res.bill); setModel(modelLabel(res.model)); setStage('review')
      } catch (e) {
        if (id !== reqRef.current) return
        setErr(e instanceof SmartError ? e.message : friendlyError(e)); setStage('input')
      }
      return
    }
    await run(() => analyzeImages(payload, mode === 'shop' ? 'shop' : 'receipt', today, (done, total) => {
      if (total > 1) setProgress(`${total}묶음 중 ${done}묶음 읽었어요`)
    }), images)
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
    let installments = 0
    let fuelSaved = 0
    let fuelFailed = false
    const txOf = new Map<string, string>()
    try {
      for (const d of chosen) {
        const r = await saveDraft(householdId, d, mode === 'text' ? 'text' : 'photo')
        txOf.set(d.key, r.txId)
        if (r.installment) installments++
        if (r.fuelSaved === true) fuelSaved++
        if (r.fuelSaved === false) fuelFailed = true
        saved++
        patch(d.key, { include: false })
      }
      // 지난 날짜에 산 할부면 이미 지난 회차를 바로 넣는다
      if (installments) await generateRecurring(householdId, today).catch(() => 0)
      // 체크한 장보기 품목을 저장한 내역에 연결한다. 실패해도 내역 저장은 되돌리지 않고 알린다
      let linked = 0
      let linkFailed = false
      for (const [tx, links] of linksByTx(lines, picks, txOf)) {
        try { linked += await linkGroceryItems(tx, links) } catch { linkFailed = true }
      }
      const parts = [installments ? `${saved}건 저장했어요. 할부 남은 회차는 고정 탭의 할부에 넣었어요` : null,
        linked ? `장보기 품목 ${linked}개를 연결했어요` : null, linkFailed ? '장보기 연결은 하지 못했어요' : null,
        fuelSaved ? `주유 기록 ${fuelSaved}건을 넣었어요` : null, fuelFailed ? '주유 기록은 저장하지 못했어요' : null].filter(Boolean)
      await onSaved(saved, chosen[chosen.length - 1].date,
        parts.length ? (installments ? parts.join('. ') : [`${saved}건 저장했어요`, ...parts].join('. ')) : undefined)
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
          <button className="primary" disabled={!text.trim()} onClick={() => run(() => analyze({ kind: 'text', text, today }))}>분석하기</button>
        </>
      )}

      {stage === 'input' && mode !== 'text' && (
        <>
          <p className="note">
            {mode === 'bill'
              ? '아파트 관리비 고지서(내역서)를 찍거나 관리비 앱 화면을 캡처해서 고르세요. 항목별 금액과 전기·수도·난방 사용량을 읽어 전월·전년 같은 달과 비교합니다. 앞뒤 여러 장이면 모두 넣으세요(최대 5장).'
              : mode === 'shop'
              ? '쿠팡·오늘의집·컬리·네이버페이·스마트스토어의 주문·결제 내역 화면을 캡처해서 고르세요. 상품 이름·수량·금액과 상품 사진까지 함께 저장합니다. 여러 쇼핑몰 캡처를 섞어 넣어도 되고, 한 주문이 길면 이어서 찍은 캡처를 모두 넣으세요. 최대 20장, 여러 번에 나눠 넣어도 됩니다.'
              : '종이 영수증, 카드앱 결제 화면, 배달 주문내역을 찍거나 캡처해서 고르세요. 사진은 최대 20장까지 모아서 한 번에 분석합니다. 여러 번에 나눠 넣어도 됩니다.'}
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
              {preparing ? '사진 준비 중…' : mode === 'shop' ? '주문내역 캡처 고르기' : mode === 'bill' ? '고지서 찍거나 고르기' : '사진 찍거나 고르기'}
            </button>
          ) : (
            <>
              <button className="primary" disabled={preparing} onClick={() => void analyzePhotos()}>
                {preparing ? '사진 준비 중…' : `사진 ${images.length}장 분석하기`}
              </button>
              {images.length < maxPhotos && (
                <button className="ghost" disabled={preparing} onClick={() => fileRef.current?.click()}>
                  사진 더 넣기 ({images.length}/{maxPhotos})
                </button>
              )}
            </>
          )}
        </>
      )}

      {stage === 'loading' && (
        <div className="smart-loading" role="status">
          {previews}
          {/* 상태 문장은 실제 단계(묶음 진행)가 바뀔 때만 바뀐다. 기다리는 동안은 반짝임으로 살아 있음을 보여 준다 */}
          <p className="lead shimmer">{progress || (mode === 'text' ? '문자를 읽는 중이에요' : `사진 ${images.length}장을 읽는 중이에요`)}</p>
          <p className="tx-meta" style={{ justifyContent: 'center' }}>
            {mode === 'shop' ? '상품 사진까지 찾느라 20~40초쯤 걸려요.' : mode === 'bill' ? '고지서 표를 읽느라 10~30초쯤 걸려요.' : '보통 5~15초 걸려요.'}
            {mode !== 'bill' && images.length > BATCH_SIZE && ` 사진이 많아 ${BATCH_SIZE}장씩 나눠 동시에 읽어요.`}
          </p>
        </div>
      )}

      {stage === 'review' && mode === 'bill' && bill && (
        <>
          <BillReview bill={bill} householdId={householdId} today={today} categories={categories} onSaved={onSaved}
            onRetry={() => { setStage('input'); setErr('') }} />
          {model && <p className="tx-meta">{model}로 읽었어요</p>}
        </>
      )}

      {stage === 'review' && mode !== 'bill' && (
        <>
          {note && <p className="note">{note}</p>}
          {groups.map((g) => (
            <div key={g.index} className="draft-group">
              {canSplit(g.entry) && (
                <label className="check split-toggle">
                  <input type="checkbox" checked={g.split} onChange={() => toggleSplit(g.index)} />
                  <span>
                    {g.entry.platform || g.entry.merchant || '주문'} {won(g.entry.amount)}원, 상품 {g.entry.items.filter(isProductLine).length}개를
                    {' '}{g.split ? '하나씩 따로 저장' : '한 내역으로 저장'} (눌러서 바꾸기)
                  </span>
                </label>
              )}
              {/* 분석을 다시 하면 초안 key('0', '0-1')가 같아도 카드를 새로 만든다(주유 칸의 입력 글자 같은 카드 안 상태가 남지 않게) */}
              {drafts.filter((d) => groupOf(d) === g.index).map((d) => (
                <DraftCard key={`${reqRef.current}:${d.key}`} d={d} categories={categories} fills={fills} onChange={(p) => patch(d.key, p)} />
              ))}
              {withGrocery && compareByGroup.has(g.index) && (
                <ShopCompareCard result={compareByGroup.get(g.index)!} loading={history.loading} error={history.error} />
              )}
            </div>
          ))}
          {withGrocery && (suggested.size > 0 || linkedMatches.size > 0) && (
            <GroceryMatchCard items={grocery} lines={lines} suggested={suggested} linkedMatches={linkedMatches} picks={picks}
              onToggle={(id) => setPicks((p) => {
                const next = new Map(p)
                if (next.has(id)) next.delete(id)
                else { const k = suggested.get(id); if (k) next.set(id, k) }
                return next
              })} />
          )}
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

function DraftCard({ d, categories, fills, onChange }: {
  d: Draft
  categories: Category[]
  /** 지난 주유 기록 (주유 초안의 리터당 가격 비교용) */
  fills: FuelFill[]
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
        <label htmlFor={`d-${d.key}-title`}>내용</label>
        <input id={`d-${d.key}-title`} className="input" value={d.title} maxLength={60} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor={`d-${d.key}-platform`}>플랫폼</label>
        <PlatformInput id={`d-${d.key}-platform`} value={d.platform ?? ''} onChange={(v) => onChange({ platform: v })} />
      </div>
      <div className="row2">
        <div className="field">
          <label htmlFor={`d-${d.key}-amount`}>금액</label>
          <input id={`d-${d.key}-amount`} className="input num" inputMode="numeric" value={d.amount ? String(d.amount) : ''}
            onChange={(e) => onChange({ amount: Number(e.target.value.replace(/\D/g, '').slice(0, 10)) || 0 })} />
        </div>
        <div className="field">
          <label htmlFor={`d-${d.key}-date`}>날짜</label>
          <input id={`d-${d.key}-date`} type="date" className="input date-input" value={d.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
      </div>
      {d.type === 'expense' && (
        <InstallmentPicker id={`inst-${d.key}`} amount={d.amount} months={d.installment} split={d.splitInstallment}
          onChange={(p) => onChange({
            ...(p.months !== undefined ? { installment: p.months } : {}),
            ...(p.split !== undefined ? { splitInstallment: p.split } : {}),
          })} />
      )}
      {d.memo && <p className="tx-meta">{d.memo}</p>}
      {d.fuel && <FuelFields fuel={d.fuel} amount={d.amount} date={d.date} fills={fills} onChange={(fuel) => onChange({ fuel })} />}
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
          <span className="lbl">품목 {d.items.length}개, 합계 <span className="num">{won(sum)}</span>원</span>
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

/** 주유 초안의 유종·주유량·리터당 단가 칸. 리터와 단가가 둘 다 있어야 주유 기록이 저장된다 */
function FuelFields({ fuel, amount, date, fills, onChange }: {
  fuel: DraftFuel
  amount: number
  date: string
  fills: FuelFill[]
  onChange: (fuel: DraftFuel) => void
}) {
  // 치는 동안 글자가 값 검사에 지워지지 않게('35.'이 '35'로, '16'이 ''로) 칸의 글자는 따로 둔다. 값은 검사에 통과한 것만 초안에 올린다
  const [litersText, setLitersText] = useState(fuel.liters === null ? '' : String(fuel.liters))
  const [pplText, setPplText] = useState(fuel.price_per_liter === null ? '' : String(fuel.price_per_liter))
  const complete = fuelComplete(fuel)
  const product = complete ? Math.round(fuel.liters * fuel.price_per_liter) : null
  const gap = product !== null ? product - amount : 0
  // 지난 주유 대비: 이 초안을 가장 최근 주유로 두고 같은 유종의 지난 기록과 견준다
  const delta = complete
    ? fuelDelta([{ id: 'draft', transaction_id: 'draft', liters: fuel.liters, price_per_liter: fuel.price_per_liter, fuel_type: fuel.fuel_type, occurred_on: date, amount, title: '' },
        ...fills.filter((f) => f.occurred_on <= date)]) // 같은 날은 들어온 순서라 초안이 먼저다
    : null
  const sameKind = fills.some((f) => f.occurred_on <= date && fuelKind(f.fuel_type) === fuelKind(fuel.fuel_type))
  return (
    <div className="field fuel-block">
      <span className="lbl">주유</span>
      <div className="fuel-fields">
        <div className="field">
          <label htmlFor="fuel-type">유종</label>
          <input id="fuel-type" className="input" value={fuel.fuel_type ?? ''} maxLength={20} placeholder="휘발유"
            onChange={(e) => onChange({ ...fuel, fuel_type: e.target.value || null })} />
        </div>
        <div className="field">
          <label htmlFor="fuel-liters">주유량(L)</label>
          <input id="fuel-liters" className="input num" inputMode="decimal" value={litersText} placeholder="35.2"
            onChange={(e) => {
              const t = e.target.value.replace(/[^\d.]/g, '').replace(/^(\d*\.\d{0,3}).*$/, '$1').slice(0, 8)
              setLitersText(t)
              onChange({ ...fuel, liters: parseLiters(t) })
            }} />
        </div>
        <div className="field">
          <label htmlFor="fuel-ppl">리터당(원)</label>
          <input id="fuel-ppl" className="input num" inputMode="numeric" value={pplText} placeholder="1652"
            onChange={(e) => {
              const t = e.target.value.replace(/\D/g, '').slice(0, 6)
              setPplText(t)
              onChange({ ...fuel, price_per_liter: parsePricePerLiter(t) })
            }} />
        </div>
      </div>
      {product !== null ? (
        <p className="tx-meta num">단가 × 주유량 = {won(product)}원{Math.abs(gap) > amount * 0.01 ? `, 결제 금액과 ${won(Math.abs(gap))}원 달라요` : ''}</p>
      ) : (
        <p className="tx-meta">리터와 단가를 모두 적어야 주유 기록이 저장돼요. 비워 두면 내역만 저장해요.</p>
      )}
      {delta && delta.prev && delta.diff !== null && (
        <p className="tx-meta num">
          {`지난 주유(${Number(delta.prev.occurred_on.slice(5, 7))}월 ${Number(delta.prev.occurred_on.slice(8, 10))}일${delta.prev.fuel_type ? `, ${delta.prev.fuel_type}` : ''}) ${won(delta.prev.price_per_liter)}원/L보다 `}
          <PriceDelta diff={delta.diff} pct={delta.pct} />
        </p>
      )}
      {delta && !delta.prev && fills.length > 0 && !sameKind && <p className="tx-meta">같은 유종의 지난 주유 기록이 없어요.</p>}
    </div>
  )
}
