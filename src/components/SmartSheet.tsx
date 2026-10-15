import { useEffect, useRef, useState } from 'react'
import { friendlyError } from '../lib/api'
import { fileToJpeg } from '../lib/image'
import { SCOPE_LABEL, SCOPES, type Lookup } from '../lib/lookup'
import { analyze, itemsSum, saveDraft, SmartError, toDrafts, type Draft } from '../lib/smart'
import type { Category, PaymentMethod, Transaction, TxType } from '../lib/types'
import { defaultMethodId, defaultScope } from './EntrySheet'
import { Sheet } from './Sheet'

export type SmartMode = 'text' | 'photo'

interface Props {
  open: boolean
  mode: SmartMode
  today: string
  householdId: string
  lookup: Lookup
  methods: PaymentMethod[]
  categories: Category[]
  existing: Transaction[]
  onSaved: (count: number, lastDate: string) => Promise<void>
  onManual: () => void
  onClose: () => void
}

type Stage = 'input' | 'loading' | 'review'

const SAMPLE = '[Web발신]\n신한카드(1234)승인\n홍*동\n12,400원 일시불\n10/13 18:42 이마트24\n누적1,234,560원'

export function SmartSheet({ open, mode, today, householdId, lookup, methods, categories, existing, onSaved, onManual, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('input')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setStage('input'); setText(''); setDrafts([]); setNote(null); setErr(''); setBusy(false)
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return null })
  }, [open, mode])

  async function run(body: Parameters<typeof analyze>[0]) {
    setStage('loading'); setErr('')
    try {
      const res = await analyze(body)
      const ds = toDrafts(res.entries, {
        today, methods, categories, existing,
        fallbackMethodId: defaultMethodId(methods, lookup), fallbackScope: defaultScope(lookup),
      })
      setDrafts(ds); setNote(res.note)
      if (!ds.length) { setErr(res.note ?? '거래 내역을 찾지 못했어요.'); setStage('input'); return }
      setStage('review')
    } catch (e) {
      setErr(e instanceof SmartError ? e.message : friendlyError(e)); setStage('input')
    }
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

  async function onFile(file: File | undefined) {
    if (!file) return
    setErr('')
    try {
      const img = await fileToJpeg(file)
      setPreview((p) => { if (p) URL.revokeObjectURL(p); return img.preview })
      await run({ kind: 'image', image: { media_type: img.media_type, data: img.data }, today })
    } catch (e) {
      setErr(e instanceof SmartError ? e.message : '사진을 읽지 못했어요. 다른 사진으로 해 보세요.'); setStage('input')
    }
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
        await saveDraft(householdId, d, mode === 'photo' ? 'photo' : 'text')
        saved++
        patch(d.key, { include: false })
      }
      await onSaved(saved, chosen[chosen.length - 1].date)
    } catch (e) {
      setErr(`${saved}건 저장 후 멈췄어요: ${friendlyError(e)}`); setBusy(false)
    }
  }

  const title = mode === 'photo' ? '사진으로 입력' : '문자로 입력'

  return (
    <Sheet open={open} title={title} onClose={onClose}>
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

      {stage === 'input' && mode === 'photo' && (
        <>
          <p className="note">종이 영수증, 배달·쇼핑 주문내역, 카드앱 결제 화면을 찍거나 캡처해서 고르세요. 품목과 수량까지 읽어 옵니다.</p>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = '' }} />
          <button className="primary" onClick={() => fileRef.current?.click()}>사진 고르기 · 찍기</button>
          {preview && <img className="smart-preview" src={preview} alt="고른 사진" />}
          <p className="err" role="alert">{err}</p>
        </>
      )}

      {stage === 'loading' && (
        <div className="smart-loading" role="status">
          {preview && <img className="smart-preview" src={preview} alt="" />}
          <p className="lead">읽는 중이에요… 보통 5~15초 걸려요.</p>
        </div>
      )}

      {stage === 'review' && (
        <>
          {note && <p className="note">{note}</p>}
          {drafts.map((d) => (
            <DraftCard key={d.key} d={d} lookup={lookup} methods={methods} categories={categories} onChange={(p) => patch(d.key, p)} />
          ))}
          <p className="err" role="alert">{err}</p>
          <button className="primary" disabled={busy || !chosen.length} onClick={saveAll}>
            {busy ? '저장 중…' : chosen.length ? `${chosen.length}건 저장` : '저장할 내역을 고르세요'}
          </button>
          <button className="ghost" disabled={busy} onClick={() => { setStage('input'); setErr('') }}>다시 하기</button>
        </>
      )}

      {stage !== 'loading' && <button className="link-btn" onClick={onManual}>직접 입력으로 바꾸기</button>}
    </Sheet>
  )
}

function DraftCard({ d, lookup, methods, categories, onChange }: {
  d: Draft
  lookup: Lookup
  methods: PaymentMethod[]
  categories: Category[]
  onChange: (p: Partial<Draft>) => void
}) {
  const sum = itemsSum(d.items)
  const cats = categories.filter((c) => c.type === d.type)
  return (
    <div className={`card draft${d.include ? '' : ' off'}`}>
      <label className="draft-head">
        <input type="checkbox" checked={d.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <span>{d.include ? '저장' : '빼기'}</span>
        <b className={`num ${d.type === 'income' ? 'inc' : 'exp'}`}>{d.type === 'income' ? '+' : '-'}{d.amount.toLocaleString()}원</b>
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
      <div className="field">
        <span className="lbl">분류</span>
        <div className="chips">
          {cats.map((c) => (
            <button key={c.id} className="chip" aria-pressed={d.category_id === c.id} onClick={() => onChange({ category_id: c.id })}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>결제수단 · 누가 냈는지</label>
        <select className="input" value={d.payment_method_id ?? ''} onChange={(e) => onChange({ payment_method_id: e.target.value || null })}>
          <option value="">고르지 않음 (입력한 사람)</option>
          {methods.map((m) => <option key={m.id} value={m.id}>{lookup.methodLabel(m.id)}</option>)}
        </select>
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
        <details className="items">
          <summary>품목 {d.items.length}개 · 합계 <span className="num">{sum.toLocaleString()}</span>원</summary>
          <ul>
            {d.items.map((it, i) => (
              <li key={i}>
                <span>{it.name}{it.quantity !== 1 && <span className="num"> ×{it.quantity}</span>}</span>
                <span className="num">{it.amount.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
