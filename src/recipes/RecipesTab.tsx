// 가계부 안의 레시피 탭. 로그인·가구 확인은 가계부(App.tsx)가 한다. 장보기 탭처럼 바깥 상자 .recipes 안에서만 꾸민다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeRecipeUrl } from '../../supabase/functions/_shared/recipeSource'
import type { StoredRecipe } from '../../supabase/functions/_shared/recipeStored'
import { sb } from '../lib/supabase'
import { AddBar } from './components/AddBar'
import { JobList } from './components/JobList'
import { RecipeBook } from './components/RecipeBook'
import { RecipeDetail } from './components/RecipeDetail'
import { createRecipeStore, type CookableRow, type InboxJob, type RecipeStore, type RecipeSummary, type WorkerStatus } from './lib/store'
import './recipes.css'

const INVALID = '지금은 유튜브 영상과 쇼츠만 담을 수 있어요'

/** 북마크릿이 보낸 ?add=<주소>. 처음 한 번만 읽는다 */
function readAddParam(): string | null {
  const v = new URLSearchParams(window.location.search).get('add')
  return v && v.trim() ? v : null
}
/** 처리가 끝나면 주소 줄에서 tab·add를 지워 새로 고쳐도 다시 묻지 않게 한다 */
function clearAddParam() {
  const u = new URL(window.location.href)
  u.searchParams.delete('tab')
  u.searchParams.delete('add')
  window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
}

export function RecipesTab({ householdId, userId, store: injected }: { householdId: string; userId: string; store?: RecipeStore }) {
  const store = useMemo(() => injected ?? createRecipeStore(sb(), householdId, userId), [injected, householdId, userId])
  const [recipes, setRecipes] = useState<RecipeSummary[]>([])
  const [jobs, setJobs] = useState<InboxJob[]>([])
  const [worker, setWorker] = useState<WorkerStatus | null>(null)
  const [cookable, setCookable] = useState<CookableRow[] | null>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  // 모자란 재료를 장보기에 담는 창(Task 21)이 이 값을 읽는다
  const [, setMissingFor] = useState<StoredRecipe | null>(null)
  const [pending, setPending] = useState<string | null>(readAddParam)
  const [now, setNow] = useState(() => Date.now())
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const [r, j, w, c] = await Promise.all([store.listRecipes(), store.listInbox(), store.workerStatus(), store.cookable(2).catch(() => null)])
      if (mine !== seq.current) return
      setRecipes(r); setJobs(j); setWorker(w); setCookable(c); setError(null)
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : '레시피를 불러오지 못했어요')
    } finally {
      if (mine === seq.current) { setLoading(false); setNow(Date.now()) }
    }
  }, [store])

  useEffect(() => { void load(); return store.subscribe(() => void load()) }, [store, load])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t) }, [])

  /** 담기 한 번. 담았으면 true */
  async function add(url: string): Promise<boolean> {
    setBusy(true); setNotice(null)
    try {
      const out = await store.addUrl(url)
      if (out.kind === 'added') { setNotice('담았어요'); void load(); return true }
      if (out.kind === 'exists_recipe' && out.id) { setOpenId(out.id); return true }
      if (out.kind === 'exists_recipe') { setNotice('이미 레시피북에 있어요'); return true }
      setNotice(out.kind === 'exists_job' ? '이미 담겨 있어요' : INVALID)
      return out.kind === 'exists_job'
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '담지 못했어요. 잠시 뒤 다시 해 주세요')
      return false
    } finally { setBusy(false) }
  }
  async function retry(job: InboxJob) {
    setNotice(null)
    try {
      const out = await store.retry(job.id)
      setNotice(out === 'exists_job' ? '이미 담겨 있어요' : null)
      void load()
    } catch (e) { setNotice(e instanceof Error ? e.message : '다시 하지 못했어요') }
  }
  async function confirmAdd() {
    if (!pending) return
    const url = pending
    setPending(null); clearAddParam()
    await add(url)
  }

  const opened = openId ? recipes.find((r) => r.id === openId) : undefined
  const normalized = pending ? normalizeRecipeUrl(pending) : null

  return (
    <div className="recipes">
      {pending && (
        <section className="rcp-confirm" aria-label="담기 확인">
          {normalized ? (
            <>
              <p className="rcp-confirm-title">이 영상을 담을까요?</p>
              <code className="rcp-code">{normalized.url}</code>
              <div className="rcp-confirm-actions">
                <button className="rcp-btn rcp-btn-primary" type="button" disabled={busy} onClick={() => void confirmAdd()}>담기</button>
                <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => { setPending(null); clearAddParam() }}>닫기</button>
              </div>
            </>
          ) : (
            <>
              <p className="rcp-confirm-title">{INVALID}</p>
              <div className="rcp-confirm-actions">
                <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => { setPending(null); clearAddParam() }}>닫기</button>
              </div>
            </>
          )}
        </section>
      )}
      {opened ? (
        <RecipeDetail key={opened.id} store={store} recipeId={opened.id} title={opened.title} onBack={() => { setOpenId(null); void load() }} onMissing={setMissingFor} />
      ) : (
        <>
          <AddBar busy={busy} onSubmit={add} />
          {notice && <p className="rcp-notice" role="status">{notice}</p>}
          {error && (
            <div className="rcp-error" role="alert">
              <p>{error}</p>
              <button className="rcp-btn rcp-btn-quiet" type="button" onClick={() => void load()}>다시 불러오기</button>
            </div>
          )}
          <JobList jobs={jobs} worker={worker} now={now} onRetry={(j) => void retry(j)} />
          <RecipeBook recipes={recipes} cookable={cookable} loading={loading} onOpen={setOpenId} />
        </>
      )}
    </div>
  )
}
