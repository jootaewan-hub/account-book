// 요리 화면: 탭 안을 가득 채우고 큰 글씨로 한 단계씩 보인다. 그 단계의 재료와 고른 인분의 분량, 넘어가는 신호,
// 시간이 적힌 단계의 타이머, 재료 체크(이 화면 안에서만), 끝에서 다 쓴 재료 끄기. 화면은 요리하는 동안 켜 둔다.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoredRecipe } from '../../../supabase/functions/_shared/recipeStored'
import { servingsBase } from '../../../supabase/functions/_shared/recipeUnits'
import { useFocusTrap, useScrollLock } from '../../lib/dialog'
import { amountView } from '../lib/detail'
import { clock } from '../lib/display'
import type { PantryEntry } from '../lib/groceryLink'
import type { RecipeStore } from '../lib/store'

type Sentinel = { release(): Promise<void> }
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }

/** 화면 켜 두기. API가 없거나 거절돼도 아무 말 없이 넘어간다 */
function useWakeLock() {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!api || typeof api.request !== 'function') return
    let alive = true
    let held: Sentinel | null = null
    const drop = () => { const s = held; held = null; if (s) void Promise.resolve(s.release()).catch(() => {}) }
    const take = async () => {
      drop() // 숨겨졌다 돌아오면 브라우저가 이미 놓았을 수 있다. 새로 받는다
      try {
        const s = await api.request('screen')
        if (!alive) { void Promise.resolve(s.release()).catch(() => {}); return }
        held = s
      } catch { /* 배터리 절약 등으로 거절돼도 요리는 계속한다 */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void take() }
    void take()
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); drop() }
  }, [])
}

function buzz() {
  try { if (typeof navigator.vibrate === 'function') navigator.vibrate([300, 150, 300]) } catch { /* 진동이 없는 기기 */ }
}

/** 출처에 시간이 있는 단계에서만 그린다. 단계를 옮기면 key가 바뀌어 새로 맞춘다 */
function StepTimer({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds)
  const [running, setRunning] = useState(false)
  const endAt = useRef(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const rest = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000))
      setLeft(rest)
      if (rest === 0) { setRunning(false); buzz() }
    }, 250)
    return () => clearInterval(id)
  }, [running])
  const start = () => { endAt.current = Date.now() + left * 1000; setRunning(true) }
  const state = running ? '타이머가 가는 중이에요' : left === 0 ? '시간이 됐어요' : left === seconds ? '타이머가 멈춰 있어요' : '타이머를 멈췄어요'
  return (
    <div className="rcp-cook-timer">
      <p className="rcp-cook-clock" data-testid="cook-timer" aria-hidden="true">{clock(left)}</p>
      <p className="rcp-cook-timer-state" role="status">{state}{left > 0 && !running ? `, ${clock(left)} 남음` : ''}</p>
      <div className="rcp-actions">
        {running
          ? <button type="button" className="rcp-btn rcp-btn-primary rcp-cook-btn" onClick={() => setRunning(false)}>타이머 멈춤</button>
          : <button type="button" className="rcp-btn rcp-btn-primary rcp-cook-btn" disabled={left === 0} onClick={start}>타이머 시작</button>}
        <button type="button" className="rcp-btn rcp-btn-quiet rcp-cook-btn" onClick={() => { setRunning(false); setLeft(seconds) }}>타이머 처음으로</button>
      </div>
    </div>
  )
}

export function CookMode({ recipe, servings, pantry, store, onExit, onPantryChanged }: {
  recipe: StoredRecipe; /** 상세에서 고른 인분(없으면 적힌 그대로) */ servings: number | null
  pantry: readonly PantryEntry[]; store: Pick<RecipeStore, 'setPantry'>; onExit: () => void; onPantryChanged?: () => void
}) {
  const [i, setI] = useState(0)
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set())
  const [off, setOff] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLHeadingElement>(null)
  useFocusTrap(root, true, { initialFocus: head })
  useScrollLock(true)
  useWakeLock()
  // 단계가 바뀔 때마다 제목으로 포커스를 옮긴다
  useEffect(() => { if (i >= 0) head.current?.focus({ preventScroll: true }) }, [i])

  const base = useMemo(() => servingsBase(recipe), [recipe])
  const factor = base && servings ? servings / base.base : 1
  const scaled = base !== null && servings !== null && servings !== base.base
  const steps = recipe.steps
  const step = steps[i]
  const last = i === steps.length - 1
  const have = useMemo(() => new Map(pantry.map((p) => [p.ingredient_key, p.state])), [pantry])

  const toggle = (n: number) => setChecked((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x })
  const row = (n: number, portion?: string | null) => {
    const g = recipe.ingredients[n]
    const a = amountView(g, factor, scaled, recipe.measuring_tool)
    return (
      <li key={n} className="rcp-cook-ing">
        <label className="rcp-cook-check">
          <input type="checkbox" checked={checked.has(n)} onChange={() => toggle(n)} />
          <span className="rcp-cook-ing-name">{g.name}</span>
          <span className="rcp-cook-ing-amt">
            {[portion, a.main].filter(Boolean).join(', ')}
            {a.suggested && <> <span className="rcp-edit-mark">덧붙임</span> {a.suggested}</>}
          </span>
        </label>
      </li>
    )
  }
  const uses = (step?.uses ?? []).flatMap((u) => { const n = recipe.ingredients.findIndex((g) => g.name === u.name); return n < 0 ? [] : [{ n, portion: u.portion }] })

  // 다 쓴 재료 끄기: 사전 키가 있고 지금 '있음'인 것(항상 있음은 끄지 않는다)
  const spent = useMemo(() => {
    const seen = new Set<string>()
    return recipe.ingredients.flatMap((g) => {
      const k = g.ingredient_key
      if (!k || have.get(k) !== 'have' || off.has(k) || seen.has(k)) return []
      seen.add(k)
      return [{ key: k, name: g.name }]
    })
  }, [recipe, have, off])
  async function turnOff(key: string) {
    setError(null)
    try {
      await store.setPantry(key, null)
      setOff((s) => new Set(s).add(key))
      onPantryChanged?.()
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요. 잠시 뒤 다시 해 주세요') }
  }

  if (!step) return null
  return (
    <div className="rcp-cook" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="요리">
      <div className="rcp-cook-top">
        <p className="rcp-cook-count">{i + 1} / {steps.length}</p>
        <button type="button" className="rcp-btn-text" onClick={onExit}>나가기</button>
      </div>
      <div className="rcp-cook-body">
        <h2 className="rcp-cook-title" ref={head} tabIndex={-1}>{step.title}</h2>
        <p className="rcp-cook-text">{step.body}</p>
        {step.heat && <p className="rcp-cook-sub">불 {step.heat}</p>}
        {step.cue && <p className="rcp-cook-sub">넘어가는 신호: {step.cue}</p>}
        {step.editor_tip && <p className="rcp-cook-sub"><span className="rcp-edit-mark">덧붙임</span> {step.editor_tip}</p>}
        {step.timer_seconds ? <StepTimer key={i} seconds={step.timer_seconds} /> : null}
        {uses.length > 0 && <ul className="rcp-cook-ings" aria-label="이 단계 재료">{uses.map((u) => row(u.n, u.portion))}</ul>}
        <details className="rcp-cook-all">
          <summary>재료 모두 보기</summary>
          <ul className="rcp-cook-ings" aria-label="전체 재료">{recipe.ingredients.map((_, n) => row(n))}</ul>
        </details>
        {last && spent.length > 0 && (
          <fieldset className="rcp-cook-spent">
            <legend>다 쓴 재료 끄기</legend>
            <p className="rcp-meta">다 쓴 재료를 누르면 가진 재료에서 빠져요.</p>
            <div className="rcp-chips">
              {spent.map((s) => <button key={s.key} type="button" className="rcp-chip" aria-label={`${s.name} 끄기`} onClick={() => void turnOff(s.key)}>{s.name}</button>)}
            </div>
          </fieldset>
        )}
        {error && <p className="rcp-bad" role="alert">{error}</p>}
      </div>
      <div className="rcp-cook-foot">
        <button type="button" className="rcp-btn rcp-btn-quiet rcp-cook-btn" disabled={i === 0} onClick={() => setI(i - 1)}>이전</button>
        {last
          ? <button type="button" className="rcp-btn rcp-btn-primary rcp-cook-btn" onClick={onExit}>요리 끝</button>
          : <button type="button" className="rcp-btn rcp-btn-primary rcp-cook-btn" onClick={() => setI(i + 1)}>다음</button>}
      </div>
    </div>
  )
}
