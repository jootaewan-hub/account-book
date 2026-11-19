// 가진 재료 화면: 늘 있음·지금 있음 두 묶음, 사전에서 찾아 더하기, 끄기, 장보기에서 산 것 넣기.
// 장보기 표는 읽기만 한다. 산 것은 사람이 한 번 눌러야 들어가고 출처는 grocery다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boughtSuggestions, nameKey, type PantryEntry } from '../lib/groceryLink'
import type { BoughtItem, DictEntry, PantryState, RecipeStore } from '../lib/store'

/** boughtFailed: 장보기 기록을 읽지 못했다(화면은 그대로 쓰되 한 줄로 알린다) */
type Data = { pantry: PantryEntry[]; dict: DictEntry[]; bought: BoughtItem[]; boughtFailed: boolean }
const MAX_FOUND = 20

export function PantryScreen({ store, onBack }: { store: RecipeStore; onBack: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      // 장보기 기록은 부수적이라, 못 읽어도 화면은 쓸 수 있게 두고 한 줄로 알린다
      const [pantry, dict, bought] = await Promise.all([store.listPantry(), store.listDict(), store.recentBought().catch(() => null)])
      if (mine !== seq.current) return
      setData({ pantry, dict, bought: bought ?? [], boughtFailed: bought === null }); setError(null)
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : '가진 재료를 불러오지 못했어요')
    }
  }, [store])
  useEffect(() => { void load() }, [load])

  const names = useMemo(() => new Map((data?.dict ?? []).map((d) => [d.id, d.name])), [data])
  const nameOf = (key: string) => names.get(key) ?? key
  const suggested = useMemo(() => (data ? boughtSuggestions(data.bought, data.dict, data.pantry) : []), [data])
  const have = useMemo(() => new Set((data?.pantry ?? []).map((p) => p.ingredient_key)), [data])

  const q = nameKey(query)
  const matches = useMemo(() => (q && data ? data.dict.filter((d) => [d.name, ...d.aliases].some((n) => nameKey(n).includes(q))) : []), [q, data])
  const found = matches.filter((d) => !have.has(d.id)).slice(0, MAX_FOUND)

  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError(null)
    let failed: string | null = null
    try { await fn() } catch (e) { failed = e instanceof Error ? e.message : '저장하지 못했어요. 잠시 뒤 다시 해 주세요' }
    await load() // 일부만 들어갔을 수 있어 실패해도 다시 읽는다
    if (failed) setError(failed)
    setBusy(false)
  }
  const add = (key: string, state: PantryState) => run(async () => { await store.setPantry(key, state, 'manual'); setQuery('') })
  const off = (key: string) => run(() => store.setPantry(key, null))
  const takeBought = () => run(async () => { for (const key of suggested) await store.setPantry(key, 'have', 'grocery') })

  const group = (state: PantryState, label: string) => {
    const rows = (data?.pantry ?? []).filter((p) => p.state === state).sort((a, b) => nameOf(a.ingredient_key).localeCompare(nameOf(b.ingredient_key), 'ko'))
    return (
      <section className="rcp-pantry-group" aria-label={label}>
        <h3 className="rcp-h3">{label}</h3>
        {rows.length === 0 ? <p className="rcp-empty">아직 없어요</p> : (
          <ul className="rcp-pantry-list">
            {rows.map((p) => (
              <li key={p.ingredient_key} className="rcp-pantry-row">
                <span className="rcp-pantry-name">{nameOf(p.ingredient_key)}</span>
                <button type="button" className="rcp-btn rcp-btn-quiet" disabled={busy} aria-label={`${nameOf(p.ingredient_key)} 끄기`} onClick={() => void off(p.ingredient_key)}>끄기</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="rcp-pantry">
      <div className="rcp-pantry-top">
        <button type="button" className="rcp-btn-text" onClick={onBack}>뒤로</button>
        <h2 className="rcp-h2">가진 재료</h2>
      </div>
      {error && (
        <div className="rcp-error" role="alert">
          <p>{error}</p>
          <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => void load()}>다시 불러오기</button>
        </div>
      )}
      {!data ? (!error && <p className="rcp-empty">불러오는 중</p>) : (
        <>
          {data.boughtFailed && <p className="rcp-meta">장보기 기록을 읽지 못했어요</p>}
          {suggested.length > 0 && (
            <section className="rcp-pantry-bought" aria-label="장보기에서 산 것">
              <p className="rcp-pantry-bought-title">장보기에서 산 것 {suggested.length}개를 넣을까요?</p>
              <ul className="rcp-pantry-bought-list">{suggested.map((k) => <li key={k}>{nameOf(k)}</li>)}</ul>
              <button type="button" className="rcp-btn rcp-btn-primary" disabled={busy} onClick={() => void takeBought()}>넣기</button>
            </section>
          )}
          {group('always', '늘 있음')}
          {group('have', '지금 있음')}
          <section className="rcp-pantry-add" aria-label="재료 더하기">
            <h3 className="rcp-h3">재료 더하기</h3>
            {data.dict.length === 0 ? (
              <p className="rcp-empty">재료 사전이 아직 비어 있어요. 레시피를 담을 때마다 재료가 하나씩 늘어나요.</p>
            ) : (
              <>
                <input className="rcp-input" type="search" aria-label="재료 찾기" placeholder="이름이나 다른 이름으로 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
                {q && found.length === 0 && <p className="rcp-empty">{matches.length ? '이미 가진 재료에 있어요' : '찾는 재료가 사전에 없어요'}</p>}
                {found.length > 0 && (
                  <ul className="rcp-pantry-list">
                    {found.map((d) => (
                      <li key={d.id} className="rcp-pantry-row">
                        <span className="rcp-pantry-name">{d.name}</span>
                        <span className="rcp-pantry-pick">
                          <button type="button" className="rcp-btn rcp-btn-quiet" disabled={busy} aria-label={`${d.name} 늘 있음에 넣기`} onClick={() => void add(d.id, 'always')}>늘 있음</button>
                          <button type="button" className="rcp-btn rcp-btn-quiet" disabled={busy} aria-label={`${d.name} 지금 있음에 넣기`} onClick={() => void add(d.id, 'have')}>지금 있음</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
