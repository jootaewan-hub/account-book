// 처리 중인 영상의 진행 표시: 단계에 맞춰 차오르는 막대(대략의 %), 몇 초마다 바뀌는 안내 문구, 걸린 시간.
// %는 단계 순서로 어림한 값이다(단계마다 걸리는 시간이 달라 단계 사이를 천천히 채운다). 레시피의 숫자가 아니다.
// "AI"·"분석 중" 같은 말은 쓰지 않고 지금 하는 일을 그대로 말한다(CLAUDE.md 레시피 규칙).
import { useEffect, useState } from 'react'

type StageInfo = { from: number; to: number; tau: number; lines: string[] }

/** 서버 함수 STAGES와 같은 일곱 단계. from~to는 그 단계에서 막대가 차오르는 범위(%), tau는 차오르는 빠르기(초) */
export const STAGE_INFO: Record<string, StageInfo> = {
  '영상 정보 받는 중': { from: 2, to: 8, tau: 10, lines: ['영상 정보를 받아오고 있어요', '제목과 설명란을 살펴보고 있어요'] },
  '자막 받는 중': { from: 8, to: 15, tau: 15, lines: ['자막을 받아오고 있어요', '작성자가 적어 둔 분량부터 찾고 있어요'] },
  '말 받아쓰는 중': { from: 15, to: 32, tau: 40, lines: ['영상 속 말을 받아 적고 있어요', '"한 큰술" 같은 말을 놓치지 않게 듣고 있어요'] },
  '화면 글자 읽는 중': { from: 32, to: 45, tau: 30, lines: ['화면에 나온 글자를 읽고 있어요', '재료표가 나온 장면을 찾고 있어요'] },
  '레시피 정리 중': {
    from: 45, to: 82, tau: 120,
    lines: ['재료와 순서를 정리하고 있어요', '분량마다 어디서 나왔는지 붙이고 있어요', '시간이 조금 걸리는 단계예요', '조금만 기다려 주세요'],
  },
  '다시 읽어 맞춰 보는 중': { from: 82, to: 95, tau: 60, lines: ['숫자가 맞는지 한 번 더 맞춰 보고 있어요', '거의 다 됐어요'] },
  '저장 중': { from: 95, to: 99, tau: 5, lines: ['레시피북에 넣고 있어요', '곧 열어 볼 수 있어요'] },
}
export const STAGE_ORDER = Object.keys(STAGE_INFO)
const START: StageInfo = { from: 0, to: 2, tau: 10, lines: ['곧 시작해요', '처리기가 영상을 가져가고 있어요'] }
export const LINE_MS = 4000

/** 단계에 들어온 뒤 t초가 지났을 때의 막대(%). 다음 단계 시작 값에 가까워지지만 넘지 않는다 */
export function progressAt(stage: string | null, t: number): number {
  const s = (stage && STAGE_INFO[stage]) || START
  const v = s.from + (s.to - s.from) * (1 - Math.exp(-Math.max(0, t) / s.tau))
  return Math.min(s.to, Math.round(v))
}

function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}초째` : `${Math.floor(s / 60)}분째`
}

export function JobProgress({ stage, claimedAt }: { stage: string | null; claimedAt: string | null }) {
  const [tick, setTick] = useState(() => Date.now())
  // 단계가 바뀐 때를 기억한다(렌더 중에 상태를 맞추는 React 방식)
  const [stageStart, setStageStart] = useState<{ stage: string | null; at: number }>(() => ({ stage, at: Date.now() }))
  if (stageStart.stage !== stage) setStageStart({ stage, at: Date.now() })

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const info = (stage && STAGE_INFO[stage]) || START
  const inStage = (tick - stageStart.at) / 1000
  const pct = progressAt(stage, inStage)
  const line = info.lines[Math.floor((tick - stageStart.at) / LINE_MS) % info.lines.length]
  const step = stage ? STAGE_ORDER.indexOf(stage) + 1 : 0
  const since = claimedAt ? Date.parse(claimedAt) : NaN

  return (
    <div className="rcp-progress">
      <div className="rcp-progress-top">
        <span className="rcp-job-state">{stage ?? '처리 중'}</span>
        <span className="rcp-progress-pct" aria-hidden="true">{pct}%</span>
      </div>
      <div className="rcp-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={`${stage ?? '처리 중'}${step > 0 ? `, 7단계 중 ${step}단계` : ''}, 약 ${pct}%`}>
        <span className="rcp-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="rcp-progress-line" key={line} aria-hidden="true">{line}</p>
      <p className="rcp-meta">
        {step > 0 ? `${step}/7단계` : '시작 전'}
        {Number.isFinite(since) ? ` · ${elapsedText(tick - since)}` : ''}
      </p>
    </div>
  )
}
