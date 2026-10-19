// 바코드로 상품 보기(P6, 화면 설계 7·8-2절): 카메라(또는 사진)로 소매 바코드를 읽고, 먼저 식약처 기록의 바코드와 대조한다(일치하면 "기록 있음").
// 그다음 다나와 검색(새 창)과 담기(이름 읽기 또는 직접 적기)를 둔다. 목록에 담지 않고도 볼 수 있다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { checkedRange, koFullDay, SOURCE_NAME, type AlertsResult } from '../lib/alerts'
import { danawaBarcodeUrl, getDetector, normalizeBarcode, pickRetail } from '../lib/barcode'
import { READING_TEXT } from '../lib/photo'
import type { BarcodeRecord, ListStore } from '../lib/store'
import { PhotoPick } from './PhotoCapture'

const CLOSE_MS = 250
const SCAN_MS = 300

/** failed: 식약처 기록을 확인하지 못함("기록 없음"이 아니다) */
type Result = { code: string; records: BarcodeRecord[]; syncedAt: AlertsResult['syncedAt']; failed: boolean }
type Stage = 'camera' | 'nocam' | 'reading' | 'checking' | Result

type Props = {
  store: ListStore
  /** 개발용: 바로 이 바코드의 결과를 연다(카메라 없이) */
  initialCode?: string
  /** 담기 시트를 이 글로 연다 */
  onAddText: (text: string) => void
  onClose: () => void
}

export default function BarcodeSheet({ store, initialCode, onAddText, onClose }: Props) {
  const [closing, setClosing] = useState(false)
  const [stage, setStage] = useState<Stage>(initialCode ? 'checking' : 'camera')
  const [msg, setMsg] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [reading, setReading] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const sheet = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const titleId = useId()

  const stopCamera = useCallback(() => {
    window.clearInterval(timer.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  const close = () => {
    if (closing) return
    setClosing(true)
    stopCamera()
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(onClose, reduce ? 0 : CLOSE_MS)
  }

  const lookup = useCallback(
    (code: string) => {
      stopCamera()
      setStage('checking')
      store.barcodeAlerts(code).then(
        (r) => setStage({ code, records: r.records, syncedAt: r.syncedAt, failed: false }),
        () => setStage({ code, records: [], syncedAt: {}, failed: true }),
      )
    },
    [store, stopCamera],
  )

  // 개발용 initialCode: 카메라 없이 바로 결과
  useEffect(() => {
    if (initialCode) lookup(initialCode)
  }, [initialCode, lookup])

  // 카메라 열기(사용자 동작으로 연 시트 안이라 iOS에서도 된다). 못 열면 사진으로 읽기만 둔다. "다른 바코드 읽기"로 stage가 camera로 돌아오면 다시 켠다.
  useEffect(() => {
    if (stage !== 'camera') return
    let cancelled = false
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStage('nocam')
        return
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream.current = s
        if (video.current) {
          video.current.srcObject = s
          await video.current.play().catch(() => {})
        }
        const detector = await getDetector()
        timer.current = window.setInterval(async () => {
          const v = video.current
          if (!v || v.readyState < 2) return
          try {
            const code = pickRetail(await detector.detect(v))
            if (code) lookup(code)
          } catch {
            // 한 프레임 못 읽은 것은 넘어간다
          }
        }, SCAN_MS)
      } catch {
        if (!cancelled) setStage('nocam')
      }
    }
    void start()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [stage, lookup, stopCamera])

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(closeTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) close()
      if (e.key === 'Tab' && sheet.current) {
        const f = [...sheet.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([type=file])')]
        if (f.length === 0) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 사진 한 장에서 읽기(카메라를 못 열거나 손으로 고른 사진)
  const readFromImage = async (img: { blob: Blob }) => {
    setStage('reading')
    setMsg(null)
    try {
      const bitmap = await createImageBitmap(img.blob)
      const code = pickRetail(await (await getDetector()).detect(bitmap))
      bitmap.close()
      if (code) lookup(code)
      else {
        setStage('nocam')
        setMsg('바코드를 찾지 못했어요. 바코드가 크고 또렷하게 나오게 다시 찍어 주세요.')
      }
    } catch {
      setStage('nocam')
      setMsg('바코드를 읽지 못했어요. 다시 해 주세요.')
    }
  }

  // 바코드 숫자를 직접 적기(카메라도 사진도 안 될 때)
  const [typed, setTyped] = useState('')
  const submitTyped = () => {
    const code = normalizeBarcode(typed)
    if (!code) {
      setMsg('바코드는 13자리(또는 8자리) 숫자예요. 검사 숫자가 맞지 않으면 다시 확인해 주세요.')
      return
    }
    setMsg(null)
    lookup(code)
  }

  const readName = (img: { media_type: 'image/jpeg'; data: string; width: number; height: number }) => {
    setReading(true)
    store.readPhoto('product', { media_type: img.media_type, data: img.data, width: img.width, height: img.height }).then(
      (r) => {
        setReading(false)
        if (r.job === 'product' && r.query) setName(r.query)
        else setMsg('포장에서 이름을 읽지 못했어요. 직접 적어 주세요.')
      },
      (e: unknown) => {
        setReading(false)
        setMsg(e instanceof Error && e.message ? e.message : '포장에서 이름을 읽지 못했어요. 직접 적어 주세요.')
      },
    )
  }

  const result = typeof stage === 'object' ? stage : null

  return (
    <div className={`sheet-layer${closing ? ' is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={close} aria-hidden="true" />
      <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <h2 id={titleId}>바코드로 상품 보기</h2>
          <button type="button" className="btn-text" ref={closeBtn} onClick={close}>닫기</button>
        </div>
        <div className="sheet-body">
          {stage === 'camera' && (
            <>
              <video ref={video} className="barcode-video" playsInline muted aria-label="카메라 화면" />
              <p className="src-line">상품 바코드를 화면 가운데에 맞춰 주세요. 읽히면 바로 식약처 기록과 대조해요.</p>
            </>
          )}
          {(stage === 'nocam' || stage === 'camera') && (
            <div className="photo-row">
              <PhotoPick label="사진으로 읽기" inputLabel="바코드 사진" onImage={readFromImage} />
              {stage === 'nocam' && <span className="src-line">카메라를 열 수 없어요. 바코드 사진을 골라 주세요.</span>}
            </div>
          )}
          {(stage === 'nocam' || stage === 'camera') && (
            <form
              className="cand-search"
              onSubmit={(e) => {
                e.preventDefault()
                submitTyped()
              }}
            >
              <input className="cand-input num" inputMode="numeric" aria-label="바코드 숫자" placeholder="바코드 숫자 13자리" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" className="btn-secondary" disabled={!typed.trim()}>확인</button>
            </form>
          )}
          {stage === 'reading' && <p className="cand-state" role="status">바코드 읽는 중</p>}
          {stage === 'checking' && <p className="cand-state" role="status">식약처 기록 확인 중</p>}
          {msg && <p className="cand-state" role="alert">{msg}</p>}

          {result && (
            <>
              <p className="barcode-code num">바코드 {result.code}</p>
              {result.failed ? (
                <p className="cand-state" role="status">식약처 기록을 확인하지 못했어요. 잠시 뒤 "다른 바코드 읽기"로 다시 해 주세요. 확인 전에는 기록이 없다고 볼 수 없어요.</p>
              ) : result.records.length > 0 ? (
                <>
                  <p className="alert-badge alert-record">회수 기록 있음</p>
                  <ul className="alert-list">
                    {result.records.map((a) => (
                      <li key={`${a.source}-${a.sourceId}`} className="alert-card">
                        <p className="alert-product">{a.productName}</p>
                        <dl className="alert-facts">
                          {a.maker && <><dt>업체</dt><dd>{a.maker}</dd></>}
                          {a.packUnit && <><dt>포장 단위</dt><dd>{a.packUnit}</dd></>}
                          {a.reason && <><dt>사유</dt><dd>{a.reason}</dd></>}
                          {a.grade && <><dt>등급</dt><dd>{a.grade}</dd></>}
                          {a.registeredOn && <><dt>등록일</dt><dd className="num">{koFullDay(a.registeredOn)}</dd></>}
                          <dt>출처</dt><dd>{SOURCE_NAME[a.source]}</dd>
                          <dt>찾은 방법</dt><dd>바코드 일치</dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="detail-none">확인한 범위에서 바코드가 같은 식약처 기록 없음</p>
              )}
              {!result.failed && <p className="alert-range">{checkedRange(result.syncedAt)}</p>}

              <p className="detail-sub">상품 찾기</p>
              <div className="detail-links">
                <a className="btn-secondary detail-link" href={danawaBarcodeUrl(result.code)} target="_blank" rel="noopener noreferrer">다나와에서 이 바코드로 검색</a>
              </div>

              <p className="detail-sub">목록에 담기</p>
              <div className="photo-row">
                <PhotoPick label="포장 사진으로 이름 읽기" inputLabel="포장 사진" disabled={reading} onImage={readName} />
                {reading && <span className="cand-state" role="status">{READING_TEXT}</span>}
              </div>
              <form
                className="cand-search"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (name.trim()) onAddText(name.trim())
                }}
              >
                <input className="cand-input" aria-label="담을 이름" placeholder="예: 비비고 왕교자 1.05kg" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                <button type="submit" className="btn-secondary" disabled={!name.trim()}>담기</button>
              </form>
              <div className="read-actions">
                <button type="button" className="btn-text" onClick={() => { setMsg(null); setStage('camera') }}>다른 바코드 읽기</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
