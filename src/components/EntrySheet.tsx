import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSaveBatch, friendlyError, type BatchMate } from '../lib/api'
import { suggestCategory } from '../lib/categorize'
import { won } from '../lib/format'
import { fuelText } from '../lib/fuel'
import { fileToJpeg, type PreparedImage } from '../lib/image'
import { blankItem, cleanItems, mergeReread, pickRereadEntry, type EditableItem, type ItemsChange } from '../lib/itemEdit'
import { useItemImages, useReceiptImages } from '../hooks/useItemImages'
import { downloadReceiptImages, listReceiptImages, removeReceiptImages } from '../lib/receiptImages'
import { isSaveShortcut, isTextField, keypadKey, pressKey, saveKeyLabel } from '../lib/keypad'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { normalizePlatform } from '../lib/platform'
import type { Category, Scope, Transaction, TxInput, TxType } from '../lib/types'
import { CameraIcon, ChevronRight, DeviceMobileIcon, HouseIcon, ReceiptIcon } from './Icons'
import { InstallmentPicker } from './InstallmentPicker'
import { ItemEditor } from './ItemEditor'
import { PackInput } from './PackInput'
import { PhotoViewer } from './PhotoViewer'
import { PlatformInput } from './PlatformInput'
import { Sheet } from './Sheet'
import { defaultScope, lsSet } from '../lib/localPrefs'

interface Props {
  open: boolean
  editing: Transaction | null
  defaultDate: string
  /** 오늘(YYYY-MM-DD). 영수증 다시 읽기(D-053)가 서버에 넘긴다 */
  today: string
  lookup: Lookup
  categories: Category[]
  usage: Map<string, number>
  /** installment: 새 지출을 할부로 넣을 때 개월 수와 달마다 나눠 넣을지. items: 수정 시트에서 고친 품목 줄(D-052, 고친 것이 있을 때만) */
  onSave: (input: TxInput, id?: string, installment?: { months: number; split: boolean } | null, items?: ItemsChange | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** 같은 영수증에서 나눠 저장한 내역을 한꺼번에 지운다(D-027) */
  onDeleteMany?: (ids: string[]) => Promise<void>
  onClose: () => void
  /** 문자 붙여넣기·사진·쇼핑 캡처 입력으로 전환 */
  onSmart?: (mode: 'text' | 'photo' | 'shop' | 'bill') => void
}

/** 수정 시트의 품목 줄: 저장된 줄(id 있음)과 새로 더한 줄 */
type EditItem = EditableItem & { id?: string; image_path?: string | null }
type RereadCandidate = { amount: number; items: EditableItem[] }
type Reread =
  | { kind: 'preview'; candidates: RereadCandidate[]; model: string | null }
  | { kind: 'applied'; before: EditItem[]; count: number; retained: number }
/** 용량 칸을 둘 상품 줄(할인·배송비 줄은 아님). SmartSheet의 isProductLine과 같은 기준 */
const isProduct = (it: EditItem) => it.amount > 0 && !/^배송비/.test(it.name.trim())

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

export function EntrySheet({ open, editing, defaultDate, today, lookup, categories, usage, onSave, onDelete, onDeleteMany, onClose, onSmart }: Props) {
  const [type, setType] = useState<TxType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('shared')
  const [date, setDate] = useState(defaultDate)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('')
  const [memo, setMemo] = useState('')
  // 분류를 이름으로 골라 준 상태 (사용자가 직접 고르면 끝)
  const [catAuto, setCatAuto] = useState(false)
  const [months, setMonths] = useState<number | null>(null)
  const [split, setSplit] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 같은 영수증에서 나눠 저장한 내역(이 내역 포함). 사진으로 넣은 내역만 찾고, 못 찾으면 칸을 숨긴다
  const [batch, setBatch] = useState<BatchMate[]>([])
  const [confirmBatch, setConfirmBatch] = useState(false)
  // 품목 줄(D-052): 열 때 저장된 품목으로 채우고, 저장할 때 전·후를 넘긴다
  const [items, setItems] = useState<EditItem[]>([])
  const urls = useItemImages(items.map((i) => i.image_path))
  // 영수증 사진(D-053): 폴더(receipt_path)의 파일 경로, 크게 보는 사진, 지우기 확인, 다시 읽기 진행·결과
  const [receipt, setReceipt] = useState<{ paths: string[]; loaded: boolean; gone: boolean }>({ paths: [], loaded: false, gone: false })
  const receiptUrls = useReceiptImages(receipt.paths)
  const [viewing, setViewing] = useState<{ src: string; label: string } | null>(null)
  const [confirmPhotos, setConfirmPhotos] = useState(false)
  const [rereading, setRereading] = useState(false)
  const [reread, setReread] = useState<Reread | null>(null)
  const receiptRequest = useRef(0)
  const splitReceipt = Boolean(editing?.save_batch || batch.length)
  const rereadChoice = reread?.kind === 'preview' && editing && !splitReceipt
    ? pickRereadEntry(reread.candidates, editing.amount)
    : null
  const canBatch = Boolean(onDeleteMany)
  // 앱이 다시 그려질 때(실시간 갱신 등) 다시 읽지 않게 내역 id로만 다시 읽는다. 다시 읽으면 두 번 누르기 확인이 풀린다
  // eslint-disable-next-line react/exhaustive-effect-dependencies -- editing은 id·source·household_id만 쓴다
  useEffect(() => {
    setBatch([]); setConfirmBatch(false)
    if (!open || !editing || editing.source !== 'photo' || !canBatch) return
    let alive = true
    fetchSaveBatch(editing).then((b) => { if (alive) setBatch(b.length >= 2 ? b : []) }).catch(() => undefined)
    return () => { alive = false }
  }, [open, editing?.id, editing?.source, canBatch])

  // 영수증 사진 목록은 내역 id·폴더가 바뀔 때만 읽는다(실시간 갱신으로 다시 그려져도 다시 읽지 않는다)
  // eslint-disable-next-line react/exhaustive-effect-dependencies -- editing은 id·receipt_path만 쓴다
  useEffect(() => {
    setReceipt({ paths: [], loaded: false, gone: false })
    const folder = editing?.receipt_path
    if (!open || !editing || !folder) return
    let alive = true
    listReceiptImages(folder).then(
      (paths) => { if (alive) setReceipt({ paths, loaded: true, gone: false }) },
      () => { if (alive) setReceipt({ paths: [], loaded: true, gone: false }) })
    return () => { alive = false }
  }, [open, editing?.id, editing?.receipt_path])

  useEffect(() => () => { receiptRequest.current++ }, [open, editing?.id])

  useEffect(() => {
    if (!open) return
    setErr(''); setBusy(false); setConfirmDelete(false); setCatAuto(false)
    setMonths(null); setSplit(true)
    setViewing(null); setConfirmPhotos(false); setRereading(false); setReread(null)
    if (editing) {
      setType(editing.type)
      setAmount(String(editing.amount))
      setCategoryId(editing.category_id)
      setScope(editing.scope)
      setDate(editing.occurred_on)
      setTitle(editing.title)
      setPlatform(editing.platform ?? '')
      setMemo(editing.memo ?? '')
      setItems(editing.items ?? [])
      return
    }
    setType('expense')
    setAmount('')
    setCategoryId(null)
    setScope(defaultScope(lookup))
    setDate(defaultDate)
    setTitle('')
    setPlatform('')
    setMemo('')
    setItems([])
    // 시트가 열릴 때만 초기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const cats = useMemo(() => {
    return categories
      .filter((c) => c.type === type)
      .slice()
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.sort - b.sort)
  }, [categories, type, usage])

  const n = parseInt(amount || '0', 10)

  function switchType(t: TxType) {
    setType(t)
    setCategoryId(null)
    setCatAuto(false)
  }

  // 새 내역의 이름을 적으면 분류를 제안한다. 사용자가 분류를 직접 고른 뒤에는 바꾸지 않는다
  function changeTitle(v: string) {
    setTitle(v)
    if (editing || type !== 'expense' || (categoryId !== null && !catAuto)) return
    const s = suggestCategory(v, categories)
    if (s) { setCategoryId(s.id); setCatAuto(true) }
    else if (catAuto) { setCategoryId(null); setCatAuto(false) }
  }

  function press(k: string) {
    setAmount((a) => pressKey(a, k))
  }

  async function save() {
    if (!n) return setErr('금액을 입력하세요.')
    if (!categoryId) return setErr('분류를 고르세요.')
    if (!date) return setErr('날짜를 고르세요.')
    // 품목 줄: 이름 없이 금액만 적은 줄은 막고, 빈 줄은 뺀다. 고친 것이 없어도 전·후를 넘기면 차이가 없어 아무것도 안 바꾼다
    let itemChange: ItemsChange | null = null
    if (editing?.items) {
      const c = cleanItems(items)
      if (c.missingName) return setErr(`품목 ${c.missingName}번째 줄의 이름을 적어 주세요.`)
      itemChange = { before: editing.items, after: c.items }
    }
    setBusy(true); setErr('')
    const input: TxInput = {
      type, occurred_on: date, amount: n, title: title.trim(),
      category_id: categoryId, payment_method_id: editing?.payment_method_id ?? null, scope,
      platform: normalizePlatform(platform),
      memo: memo.trim() || null,
    }
    try {
      const installment = !editing && type === 'expense' && months ? { months, split } : null
      await onSave(input, editing?.id, installment, itemChange)
      if (!editing) lsSet(`ab:lastScope:${lookup.me}`, scope)
    } catch (e) {
      setErr(friendlyError(e)); setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try { await onDelete(editing.id) } catch (e) { setErr(friendlyError(e)); setBusy(false) }
  }

  /** 영수증 사진 지우기(D-053): 두 번 누르기 확인 뒤 폴더 파일을 지우고, 같은 폴더를 쓰는 내역 모두의 경로를 비운다 */
  async function removePhotos() {
    if (!editing?.receipt_path) return
    if (!confirmPhotos) return setConfirmPhotos(true)
    setBusy(true); setErr('')
    try {
      await removeReceiptImages(editing.receipt_path)
      setReceipt({ paths: [], loaded: true, gone: true }); setReread(null)
    } catch (e) { setErr(friendlyError(e)) } finally { setBusy(false); setConfirmPhotos(false) }
  }

  async function rereadReceipt() {
    if (!editing?.receipt_path || !receipt.paths.length || rereading) return
    const request = ++receiptRequest.current
    setRereading(true); setErr(''); setReread(null)
    const prepared: PreparedImage[] = []
    try {
      const { analyzeImages, modelLabel, SmartError } = await import('../lib/smart')
      try {
        const blobs = await downloadReceiptImages(receipt.paths)
        for (const b of blobs) prepared.push(await fileToJpeg(b))
        if (request !== receiptRequest.current) return
        const res = await analyzeImages(prepared.map(({ media_type, data, width, height }) => ({ media_type, data, width, height })), 'receipt', today)
        if (request !== receiptRequest.current) return
        const candidates = res.entries.filter((entry) => entry.items.length > 0).map((entry) => ({
          amount: entry.amount,
          items: entry.items.map(({ name, quantity, unit_price, amount, pack_size, pack_unit }) => ({
            name, quantity, unit_price, amount, pack_size, pack_unit,
          })),
        }))
        if (!candidates.length) {
          setErr(res.failed[0]?.message || res.note || '영수증에서 품목을 찾지 못했어요.')
          return
        }
        setReread({ kind: 'preview', candidates, model: modelLabel(res.model) })
      } catch (e) {
        if (request === receiptRequest.current) setErr(e instanceof SmartError ? e.message : friendlyError(e))
      }
    } catch (e) {
      if (request === receiptRequest.current) setErr(friendlyError(e))
    } finally {
      for (const p of prepared) URL.revokeObjectURL(p.preview)
      if (request === receiptRequest.current) setRereading(false)
    }
  }

  function applyReread() {
    if (!rereadChoice) return
    const result = mergeReread(items, rereadChoice.items)
    setReread({ kind: 'applied', before: items, count: rereadChoice.items.length, retained: result.retained })
    setItems(result.items)
  }

  async function removeBatch() {
    if (!onDeleteMany || !batch.length) return
    if (!confirmBatch) return setConfirmBatch(true)
    setBusy(true)
    try { await onDeleteMany(batch.map((b) => b.id)) } catch (e) { setErr(friendlyError(e)); setBusy(false); setConfirmBatch(false) }
  }

  // 키보드: 글자 칸 밖에서 숫자·Backspace는 금액으로, ⌘/Ctrl+Enter는 어디서든 저장
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  onKeyRef.current = (e) => {
    if (busy) return
    if (isSaveShortcut(e)) { e.preventDefault(); void save(); return }
    if (isTextField(e.target as HTMLElement | null)) return
    const k = keypadKey(e)
    if (k) { e.preventDefault(); press(k) }
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <Sheet open={open} title={editing ? '내역 수정' : '기록하기'} onClose={onClose} wide>
      {!editing && onSmart && (
        <section className="record-import" aria-labelledby="record-import-title">
          <div className="record-import-head">
            <h3 id="record-import-title">가져와서 기록</h3>
            <p>사진·캡처는 한 번에 20장까지</p>
          </div>
          <div className="record-methods">
            {([
              ['photo', '영수증', '찍거나 사진 선택', ReceiptIcon],
              ['shop', '쇼핑 캡처', '주문 화면 선택', CameraIcon],
              ['text', '문자 붙여넣기', '카드 승인·알림톡', DeviceMobileIcon],
              ['bill', '관리비 고지서', '고지서 사진 선택', HouseIcon],
            ] as const).map(([mode, label, hint, Icon]) => (
              <button key={mode} type="button" className="smart-btn record-method" aria-label={label} onClick={() => onSmart(mode)}>
                <span className="record-method-icon"><Icon /></span>
                <span><b>{label}</b><small>{hint}</small></span>
                <ChevronRight />
              </button>
            ))}
          </div>
        </section>
      )}
      {/* 휴대폰에서는 두 묶음이 풀려 한 줄로 이어지고, 넓은 화면에서는 왼쪽 금액·오른쪽 나머지 두 단이 된다 */}
      <div className="entry-grid">
        <div className="entry-col">
          <div className="manual-head">
            <h3>{editing ? '금액' : '직접 입력'}</h3>
            <div className="seg" role="group" aria-label="구분">
              <button aria-pressed={type === 'expense'} onClick={() => switchType('expense')}>지출</button>
              <button aria-pressed={type === 'income'} onClick={() => switchType('income')}>수입</button>
            </div>
          </div>
          <div className={`amount num${n ? '' : ' empty-amt'}`} aria-live="polite">{won(n)}<small>원</small></div>
          <div className="keypad">
            {KEYS.map((k) => (
              <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? '지우기' : k}>{k}</button>
            ))}
          </div>
          <p className="kbd-hint">키보드 숫자로도 금액을 넣을 수 있어요. {saveKeyLabel()}로 저장해요.</p>
        </div>
        <div className="entry-col">
          <div className="field">
            <span className="lbl">분류</span>
            <div className="chips">
              {cats.map((c) => (
                <button key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => { setCategoryId(c.id); setCatAuto(false) }}>{c.name}</button>
              ))}
            </div>
            {catAuto && <span className="tx-meta">이름을 보고 골랐어요. 다르면 바꿔 주세요.</span>}
          </div>
          <div className="field">
            <span className="lbl">{type === 'income' ? '누구의 수입인가요' : '누구를 위한 지출인가요'}</span>
            <div className="seg" role="group">
              {SCOPES.map((s) => (
                <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)}>{SCOPE_LABEL[s]}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="entry-date">날짜</label>
            <input id="entry-date" type="date" className="input date-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {!editing && type === 'expense' && (
            <InstallmentPicker id="entry-installment" amount={n} months={months} split={split}
              onChange={(p) => { if (p.months !== undefined) setMonths(p.months); if (p.split !== undefined) setSplit(p.split) }} />
          )}
          <div className="field">
            <label htmlFor="entry-title">내용</label>
            <input id="entry-title" className="input" value={title} maxLength={60} placeholder="예: 동네 마트, 물티슈 100매" onChange={(e) => changeTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="entry-platform">플랫폼</label>
            <PlatformInput id="entry-platform" value={platform} onChange={setPlatform} />
          </div>
          <div className="field">
            <label htmlFor="entry-memo">메모</label>
            <input id="entry-memo" className="input" value={memo} maxLength={200} placeholder="예: 쿠폰 2,000원 적용, 회사 회식"
              onChange={(e) => setMemo(e.target.value)} />
          </div>
          {/* 영수증 사진(D-053): 썸네일(누르면 크게), 다시 읽기, 사진 지우기(두 번 누르기). 다시 읽은 품목은 아래 품목 줄에 채워진다 */}
          {editing?.receipt_path && !receipt.gone && (
            <div className="field receipt-field">
              <span className="lbl"><ReceiptIcon />영수증 사진{receipt.paths.length > 1 ? ` ${receipt.paths.length}장` : ''}</span>
              {receipt.loaded && receipt.paths.length === 0 ? (
                <p className="tx-meta receipt-note">사진 파일을 찾지 못했어요.</p>
              ) : (
                <div className="receipt-photos">
                  {(receipt.loaded ? receipt.paths : ['']).map((p, i) => {
                    const url = p ? receiptUrls.get(p) : undefined
                    return url
                      ? <button key={p} type="button" className="receipt-thumb" aria-label={`영수증 사진 ${i + 1} 크게 보기`}
                          onClick={() => setViewing({ src: url, label: `영수증 사진 ${i + 1}` })}><img src={url} alt="" loading="lazy" /></button>
                      : <span key={p || i} className="receipt-thumb empty" aria-hidden="true" />
                  })}
                </div>
              )}
              <div className="receipt-actions">
                <button type="button" className="ghost" onClick={rereadReceipt} disabled={busy || rereading || reread?.kind === 'applied' || !receipt.paths.length}>
                  {rereading ? '영수증 사진 읽는 중…' : '영수증 다시 읽기'}
                </button>
                <button type="button" className="link-btn remove" onClick={removePhotos} disabled={busy || rereading}>
                  {confirmPhotos ? '한 번 더 누르면 사진을 지워요' : '사진 지우기'}
                </button>
              </div>
              {reread?.kind === 'preview' && (
                <div className="reread-review">
                  <p className="tx-meta receipt-note" role="status">
                    {splitReceipt ? '상품별로 나눠 저장한 내역이에요. 읽은 품목을 참고해 필요한 줄만 직접 고쳐 주세요.'
                      : rereadChoice ? '다시 읽은 품목을 확인한 뒤 적용해 주세요.'
                      : '이 내역과 일치하는 결제를 하나로 고를 수 없어요. 읽은 품목을 참고해 직접 고쳐 주세요.'}
                    {reread.model && ` ${reread.model}로 읽었어요.`}
                  </p>
                  {(rereadChoice ? [rereadChoice] : reread.candidates).map((candidate, i) => (
                    <details key={i} className="reread-candidate" open={candidate === rereadChoice || undefined}>
                      <summary>결제 {won(candidate.amount)}원 · 품목 {candidate.items.length}개</summary>
                      <ul>
                        {candidate.items.map((item, j) => <li key={j}><span>{item.name}</span><b className="num">{won(item.amount)}원</b></li>)}
                      </ul>
                    </details>
                  ))}
                  {rereadChoice && <button type="button" className="ghost" onClick={applyReread} disabled={busy}>읽은 품목 적용</button>}
                </div>
              )}
              {reread?.kind === 'applied' && (
                <div className="reread-review">
                  <p className="tx-meta receipt-note" role="status">
                    읽은 품목 {reread.count}개를 적용했어요. 금액과 품목을 확인하고 저장해 주세요.
                    {reread.retained > 0 && ` 일치하지 않은 기존 품목 ${reread.retained}개는 목록 끝에 남겼어요.`}
                  </p>
                  <button type="button" className="link-btn" disabled={busy} onClick={() => { setItems(reread.before); setReread(null) }}>적용 전 품목으로 되돌리기</button>
                </div>
              )}
            </div>
          )}
          {editing?.receipt_path && receipt.gone && <p className="tx-meta receipt-note">영수증 사진을 지웠어요.</p>}
          {/* 품목 줄(D-052): 영수증·문자로 넣은 내역은 줄이 없어도 더할 수 있고, 손으로 넣은 내역은 줄이 있을 때만 보인다 */}
          {editing?.items && (items.length > 0 || editing.source !== 'manual') && (
            <div className="field">
              <span className="lbl">품목 {items.length}개</span>
              <ItemEditor<EditItem> items={items} total={n} onChange={setItems} make={blankItem}
                renderThumb={(it) => it.image_path && urls.get(it.image_path)
                  ? <img className="item-thumb" src={urls.get(it.image_path)} alt="" loading="lazy" />
                  : null}
                renderExtra={(it, i) => isProduct(it) && (
                  <PackInput name={it.name} size={it.pack_size} unit={it.pack_unit}
                    onChange={(p) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)))} />
                )} />
            </div>
          )}
          {editing?.fuel && (
            <div className="field">
              <span className="lbl">주유</span>
              <p className="tx-meta fuel-readonly num">{fuelText(editing.fuel)}. 리터·단가를 고치려면 이 내역을 지우고 영수증을 다시 찍어요.</p>
            </div>
          )}
          <p className="err" role="alert">{err}</p>
          <button className="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : n ? `${won(n)}원 저장하기` : '저장하기'}</button>
          {editing && (
            <button className="danger" onClick={remove} disabled={busy}>{confirmDelete ? '한 번 더 누르면 지워요' : '삭제하기'}</button>
          )}
          {editing && batch.length > 0 && (
            <div className="field batch-del">
              <span className="lbl">함께 나눠 저장한 내역 {batch.length}건</span>
              <ul className="batch-list">
                {batch.map((b) => (
                  <li key={b.id} className={b.id === editing.id ? 'cur' : undefined}>
                    <span className="batch-name">{b.title || '이름 없음'}{b.id === editing.id && <span className="tag batch-cur">지금 보는 내역</span>}</span>
                    <span className="num">{won(b.amount)}원</span>
                  </li>
                ))}
                <li className="batch-sum"><span>합계</span><span className="num">{won(batch.reduce((s, b) => s + b.amount, 0))}원</span></li>
              </ul>
              <button className="danger" onClick={removeBatch} disabled={busy}>
                {confirmBatch ? `한 번 더 누르면 ${batch.length}건 지워요` : `${batch.length}건 모두 삭제`}
              </button>
            </div>
          )}
        </div>
      </div>
      {viewing && <PhotoViewer src={viewing.src} label={viewing.label} onClose={() => setViewing(null)} />}
    </Sheet>
  )
}
