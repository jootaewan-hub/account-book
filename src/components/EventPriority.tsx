import { EFFECT_LABEL, EFFECTS, eventEffect, eventPriority, fxClass, PRIORITIES, PRIORITY_LABEL } from '../lib/events'
import type { CalEvent, EventEffect, EventPriority } from '../lib/types'
import { StarIcon } from './Icons'

type Marked = Pick<CalEvent, 'priority' | 'effect'>

/** '점·별' 효과의 표시(D-054): 중요는 점, 꼭은 별. 다른 효과·보통 일정은 없음. 장식이라 읽기에서 뺀다(읽기는 "중요"·"꼭" 글자가 맡는다) */
export function EventMark({ e }: { e: Marked }) {
  const p = eventPriority(e)
  if (p === 'normal' || eventEffect(e) !== 'mark') return null
  return p === 'must' ? <i className="fx-m star" aria-hidden="true"><StarIcon /></i> : <i className="fx-m dot" aria-hidden="true" />
}

/** 중요·꼭 일정의 글자 태그. 효과가 무엇이든 붙여 색·움직임만으로 알리지 않는다. 보통은 없음 */
export function PriorityTag({ e }: { e: Marked }) {
  const p = eventPriority(e)
  return p === 'normal' ? null : <span className={`tag pri p-${p}`}>{PRIORITY_LABEL[p]}</span>
}

/** 일정 넣기·고치기의 중요도 세 칸과, 중요·꼭일 때 표시 효과 고르기(칸마다 달력 칸 이름 모양의 미리보기) */
export function EventPriorityFields({ priority, effect, sample, onChange }: {
  priority: EventPriority
  effect: EventEffect
  /** 미리보기에 쓸 일정 이름(비어 있으면 "일정 이름") */
  sample: string
  onChange: (v: { priority: EventPriority; effect: EventEffect }) => void
}) {
  const name = sample.trim() || '일정 이름'
  return (
    <>
      <div className="field">
        <span className="lbl">중요도</span>
        <div className="seg" role="group" aria-label="중요도">
          {PRIORITIES.map((p) => (
            <button type="button" key={p} aria-pressed={priority === p} onClick={() => onChange({ priority: p, effect })}>{PRIORITY_LABEL[p]}</button>
          ))}
        </div>
      </div>
      {priority !== 'normal' && (
        <div className="field">
          <span className="lbl" id="ev-fx-lbl">달력에 보일 효과</span>
          <div className="fx-pick" role="group" aria-labelledby="ev-fx-lbl">
            {EFFECTS.map((fx) => (
              <button type="button" key={fx} className="fx-opt" aria-pressed={effect === fx} onClick={() => onChange({ priority, effect: fx })}>
                <span className={`fx-demo ${fxClass({ priority, effect: fx })}`} aria-hidden="true"><EventMark e={{ priority, effect: fx }} />{name}</span>
                <span className="fx-name">{EFFECT_LABEL[fx]}</span>
              </button>
            ))}
          </div>
          <p className="fx-note">달력 칸, 고른 날 줄, 다가오는 일정에 이 모양으로 보여요. 배우자 화면에도 같아요.{effect === 'breathe' ? ' 움직임 줄이기를 켠 기기에서는 테두리로 보여요.' : ''}</p>
        </div>
      )}
    </>
  )
}
