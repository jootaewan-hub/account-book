import { useState, type CSSProperties, type ReactNode } from 'react'

/*
 * 불러오는 중 화면(DESIGN.md 상태·Motion). 두 가지를 쓴다.
 * - 앱을 열 때: 앱 마크와 이름, 상태 문장 한 줄(반짝임). 흰 화면이나 글자 한 줄 대신 보인다.
 * - 화면 안: 실제 내용 모양을 따른 자리 표시. 숫자 자리에 0원을 미리 보이지 않는다.
 *   200ms 안에 오면 자리 표시가 보이지 않게 늦게 나타나고, 보조기기에는 상태 문장 하나만 읽힌다.
 */

/** 앱 마크(public/favicon.svg와 같은 그림). 색은 화면 색(밝게·어둡게)을 따른다 */
export function AppMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect className="mark-bg" width="64" height="64" rx="14" />
      <rect className="mark-line" x="14" y="17" width="36" height="32" rx="6" fill="none" strokeWidth="4" />
      <path className="mark-line" d="M14 27h36M24 12v9M40 12v9" strokeWidth="4" strokeLinecap="round" />
      <rect className="mark-dot" x="34" y="34" width="9" height="8" rx="2" />
    </svg>
  )
}

/** 앱을 열 때(세션·가구를 읽는 동안). 처음 불러오기가 실패하면 같은 자리에 이유와 다시 시도 */
export function BootScreen({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="app wrap center boot">
      <AppMark className="boot-mark" />
      <p className="boot-name">우리집 가계부</p>
      {error ? (
        <>
          <p className="lead">가계부를 불러오지 못했어요</p>
          <p className="err">{error}</p>
          {onRetry && <button className="ghost" onClick={onRetry}>다시 시도</button>}
        </>
      ) : <p className="boot-status shimmer" role="status">가계부 불러오는 중</p>}
    </div>
  )
}

/** 글자 한 줄 자리. 둘러싼 글의 크기·줄 높이를 그대로 써서 내용이 와도 높이가 바뀌지 않는다. w는 글자 크기 배수(em) 또는 CSS 길이 */
export function Bar({ w, h, className }: { w: number | string; h?: number; className?: string }) {
  const style: CSSProperties = { width: typeof w === 'number' ? `${w}em` : w }
  if (h) style.height = h
  return <span className={`wait-bar${h ? ' block' : ''}${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />
}

/** 자리 표시 묶음. label은 보조기기가 읽는 상태 문장(하는 일 그대로). 같은 화면에 이미 상태 문장이 있으면 뺀다 */
export function Waiting({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className="wait">
      {label && <p className="wait-sr" role="status">{label}</p>}
      <div className={className} aria-hidden="true">{children}</div>
    </div>
  )
}

// 줄마다 폭을 조금씩 달리해 글처럼 보이게 한다(이름, 보조 정보, 금액)
const ROW_W: [string, string, number][] = [['48%', '66%', 4.5], ['36%', '52%', 3.5], ['58%', '40%', 5], ['42%', '60%', 4]]

/** 내역 행 모양 자리(이름·보조 정보·금액). day면 위에 날짜 줄 자리도 둔다(내역 탭) */
export function RowsWait({ label, rows = 3, day = false }: { label?: string; rows?: number; day?: boolean }) {
  return (
    <Waiting label={label}>
      {day && <p className="day-head wait-day"><Bar w={6} /></p>}
      {ROW_W.slice(0, rows).map(([t, m, a], i) => (
        <div key={i} className="wait-tx">
          <span><span className="tx-title"><Bar w={t} /></span><span className="tx-meta"><Bar w={m} /></span></span>
          <span className="tx-amt"><Bar w={a} /></span>
        </div>
      ))}
    </Waiting>
  )
}

/** 귀리 면 묶음 모양 자리: 제목 한 줄, 글 줄들, 그래프 같은 덩어리 */
export function CardWait({ title, lines = [], block }: { title: number; lines?: (number | string)[]; block?: number }) {
  return (
    <div className="card">
      <p className="section-title"><Bar w={title} /></p>
      {lines.map((w, i) => <p key={i} className="wait-line"><Bar w={w} /></p>)}
      {block ? <Bar w="100%" h={block} /> : null}
    </div>
  )
}

/** 따로 받는 화면이 오는 동안(Suspense) */
export function ScreenWait() {
  return (
    <Waiting label="화면 불러오는 중" className="view">
      <CardWait title={7} lines={['72%', '48%']} />
      <CardWait title={5} block={120} />
      <CardWait title={6} lines={['64%', '80%', '40%']} />
    </Waiting>
  )
}

/** 통계 화면 처음 불러오기: 이번 달 합계, 살펴보기, 주별, 12개월 그래프 순서를 따른다 */
export function StatsWait() {
  return (
    <Waiting label="통계 불러오는 중" className="view">
      <CardWait title={10} lines={[6, 9, 6, 9]} />
      <CardWait title={6} lines={['86%', '70%', '78%']} />
      <CardWait title={5} lines={['100%', '100%', '100%', '100%']} />
      <CardWait title={6} block={160} />
    </Waiting>
  )
}

/**
 * 이 화면이 자리 표시를 보였을 때만 뒤에 온 내용을 흐림 교차로 들인다(400ms). 붙일 요소는 내용이 온 뒤에 새로 그려지는 것이어야 한다.
 * 탭을 옮겨 이미 받은 내용을 다시 그릴 때는 움직이지 않는다(아래 탭 전환은 움직임 없음)
 */
export function useAppear(loading: boolean) {
  const [waited, setWaited] = useState(loading)
  if (loading && !waited) setWaited(true)
  return waited && !loading ? 'wait-done' : ''
}
