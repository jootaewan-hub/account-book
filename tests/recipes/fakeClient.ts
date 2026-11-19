// 레시피 저장소 시험용 가짜 Supabase 클라이언트. 표는 메모리 배열이다.
type Row = Record<string, unknown>
type Err = { code?: string; message: string }
export type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] }

export function fakeClient(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((x) => ({ ...x }))
  const calls: Call[] = []
  const failures: { table: string; op: string; error: Err }[] = []
  const rpcs: { name: string; args: unknown; result?: { data: unknown; error: Err | null } }[] = []
  const rpcResults: Record<string, { data: unknown; error: Err | null }> = {}
  const channels: { name: string; ons: { filter: Row; }[]; removed: boolean }[] = []
  let ids = 0

  function builder(schema: string, name: string) {
    const key = `${schema}.${name}`
    tables[key] ??= []
    const q: { op: string; payload?: unknown; filters: [string, string, unknown][]; sel: boolean; ord?: [string, boolean]; rng?: [number, number]; lim?: number; one?: 'single' | 'maybe'; count?: boolean; onConflict?: string } = { op: 'select', filters: [], sel: false }
    const run = (): { data: unknown; error: Err | null; count?: number | null } => {
      calls.push({ table: key, op: q.op, payload: q.payload, filters: [...q.filters] })
      const fi = failures.findIndex((f) => f.table === key && f.op === q.op)
      if (fi >= 0) return { data: null, error: failures.splice(fi, 1)[0].error }
      const match = (row: Row) => q.filters.every(([c, op, v]) => {
        const x = row[c]
        if (op === 'eq') return x === v
        if (op === 'neq') return x !== v
        if (op === 'in') return (v as unknown[]).includes(x)
        if (op === 'is') return (x ?? null) === v
        if (op === 'gte') return x != null && String(x) >= String(v)
        return true
      })
      const rows = tables[key]
      if (q.op === 'insert') {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[]
        const added = list.map((p) => ({ id: `id${++ids}`, ...p }))
        rows.push(...added)
        return fin(added)
      }
      if (q.op === 'update') {
        const hit = rows.filter(match)
        hit.forEach((row) => Object.assign(row, q.payload))
        return fin(hit)
      }
      if (q.op === 'delete') {
        const hit = rows.filter(match)
        tables[key] = rows.filter((row) => !hit.includes(row))
        return fin(hit)
      }
      let out = rows.filter(match)
      const total = out.length
      if (q.ord) { const [c, asc] = q.ord; out = [...out].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (asc ? 1 : -1)) }
      if (q.rng) out = out.slice(q.rng[0], q.rng[1] + 1)
      if (q.lim != null) out = out.slice(0, q.lim)
      return { ...fin(out), count: q.count ? total : null }
    }
    const fin = (data: Row[]) => {
      if (q.op !== 'select' && !q.sel) return { data: null, error: null }
      if (q.one === 'single') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no row' } }
      if (q.one === 'maybe') return { data: data[0] ?? null, error: null }
      return { data, error: null }
    }
    const api: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string }) => { q.sel = true; q.count = !!o?.count; return api },
      insert: (p: unknown) => { q.op = 'insert'; q.payload = p; return api },
      update: (p: unknown) => { q.op = 'update'; q.payload = p; return api },
      delete: () => { q.op = 'delete'; return api },
      eq: (c: string, v: unknown) => { q.filters.push([c, 'eq', v]); return api },
      neq: (c: string, v: unknown) => { q.filters.push([c, 'neq', v]); return api },
      in: (c: string, v: unknown[]) => { q.filters.push([c, 'in', v]); return api },
      is: (c: string, v: unknown) => { q.filters.push([c, 'is', v]); return api },
      gte: (c: string, v: unknown) => { q.filters.push([c, 'gte', v]); return api },
      order: (c: string, o?: { ascending?: boolean }) => { q.ord = [c, o?.ascending !== false]; return api },
      range: (a: number, b: number) => { q.rng = [a, b]; return api },
      limit: (n: number) => { q.lim = n; return api },
      single: () => { q.one = 'single'; return api },
      maybeSingle: () => { q.one = 'maybe'; return api },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad),
    }
    return api
  }

  const client = {
    schema: (schema: string) => ({
      from: (name: string) => builder(schema, name),
      rpc: async (name: string, args: unknown) => {
        rpcs.push({ name, args })
        return rpcResults[name] ?? { data: true, error: null }
      },
    }),
    channel: (name: string) => {
      const ch = { name, ons: [] as { filter: Row }[], removed: false }
      channels.push(ch)
      const api = { on: (_t: string, filter: Row) => { ch.ons.push({ filter }); return api }, subscribe: () => api }
      return Object.assign(api, { __ch: ch })
    },
    removeChannel: async (api: { __ch: { removed: boolean } }) => { api.__ch.removed = true },
  }
  return {
    client: client as never,
    tables, calls, rpcs, channels,
    failNext: (table: string, op: string, error: Err) => { failures.push({ table, op, error }) },
    setRpc: (name: string, result: { data: unknown; error: Err | null }) => { rpcResults[name] = result },
  }
}
