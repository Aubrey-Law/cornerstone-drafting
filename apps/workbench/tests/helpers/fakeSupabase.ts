/**
 * A minimal in-memory stand-in for a Supabase client's query builder,
 * covering only the chain shapes this codebase's persistence modules
 * actually use: `.from(table).select(...).eq(...).order(...).limit(...).maybeSingle()`,
 * `.insert(row).select('id').single()`, `.update(partial).eq(...)`,
 * `.upsert(row, { onConflict }).eq(...)`, and a bare `await` on any of those
 * (the query builder is a thenable, exactly as the real client's is).
 *
 * Not a general Supabase mock — just enough surface for a run's whole path
 * (`loadPublishedPrompt`, `loadSourceRows`, `openRun`/`recordStep`/
 * `finaliseRun`, `saveFindings`, `emitTasks`) to run against seeded rows
 * without a network, so a test can prove what got written and in what order.
 *
 * `.delete()` was added for retry (`lib/runs/retry.ts`), which deletes a
 * retried unit's superseded finding by id before writing the new one.
 *
 * `.rpc()` was added for `lib/runs/triggers.ts`, which claims a stage trigger
 * through `claim_prompt_stage_trigger` — a plpgsql function, not a table, so
 * nothing in `FakeQueryBuilder` can stand in for it. A test supplies the
 * response its scenario needs via `rpcHandlers`, keyed by function name.
 */
type Row = Record<string, unknown>

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

class FakeTable {
  rows: Row[] = []
  /**
   * A message this table answers every read and write with, instead of rows.
   *
   * Added because nothing here could simulate a query *failing*, and the code
   * under test is full of `if (error) throw` branches that therefore had no
   * test reaching them. The one that mattered: a design sheet whose slot
   * `contact_id` is the sentinel `__design_sheet_client__` rather than a uuid
   * makes Postgres reject the contacts read, `loadSourceRows` throw, and — until
   * 2026-09-09 — a stage trigger stay `claimed` forever. Seven of forty-four
   * sheets carry such a value, and two matters were silently never audited.
   */
  failure: string | null = null
  constructor(public name: string) {}
}

type PendingOp =
  | { type: 'insert'; payload: Row | Row[] }
  | { type: 'update'; payload: Row }
  | { type: 'upsert'; payload: Row; onConflict?: string }
  | { type: 'delete' }

class FakeQueryBuilder {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private orderSpec: { column: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private pendingOp: PendingOp | null = null

  constructor(private table: FakeTable) {}

  select(_columns?: string) {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value])
    return this
  }

  in(column: string, values: unknown[]) {
    this.inFilters.push([column, values])
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderSpec = { column, ascending: options?.ascending ?? true }
    return this
  }

  limit(count: number) {
    this.limitN = count
    return this
  }

  insert(payload: Row | Row[]) {
    this.pendingOp = { type: 'insert', payload }
    return this
  }

  update(payload: Row) {
    this.pendingOp = { type: 'update', payload }
    return this
  }

  upsert(payload: Row, options?: { onConflict?: string }) {
    this.pendingOp = { type: 'upsert', payload, onConflict: options?.onConflict }
    return this
  }

  delete() {
    this.pendingOp = { type: 'delete' }
    return this
  }

  private matches(row: Row): boolean {
    for (const [column, value] of this.filters) if (row[column] !== value) return false
    for (const [column, values] of this.inFilters) if (!values.includes(row[column])) return false
    return true
  }

  private failureOf(): { data: null; error: { message: string } } | null {
    return this.table.failure === null ? null : { data: null, error: { message: this.table.failure } }
  }

  private resolve(): { data: Row[]; error: null } {
    if (!this.pendingOp) {
      let rows = this.table.rows.filter((row) => this.matches(row))
      if (this.orderSpec) {
        const { column, ascending } = this.orderSpec
        rows = [...rows].sort((a, b) => {
          const av = a[column] as number
          const bv = b[column] as number
          return ascending ? av - bv : bv - av
        })
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN)
      return { data: rows, error: null }
    }

    if (this.pendingOp.type === 'insert') {
      const payloads = Array.isArray(this.pendingOp.payload) ? this.pendingOp.payload : [this.pendingOp.payload]
      const inserted = payloads.map((payload) => {
        const row: Row = { id: nextId(this.table.name), ...payload }
        this.table.rows.push(row)
        return row
      })
      return { data: inserted, error: null }
    }

    if (this.pendingOp.type === 'update') {
      const rows = this.table.rows.filter((row) => this.matches(row))
      for (const row of rows) Object.assign(row, this.pendingOp!.payload)
      return { data: rows, error: null }
    }

    if (this.pendingOp.type === 'delete') {
      const removed = this.table.rows.filter((row) => this.matches(row))
      this.table.rows = this.table.rows.filter((row) => !this.matches(row))
      return { data: removed, error: null }
    }

    // upsert
    const onConflict = (this.pendingOp.onConflict ?? 'id').split(',')
    const payload = this.pendingOp.payload
    const existing = this.table.rows.find((row) => onConflict.every((column) => row[column] === payload[column]))
    if (existing) {
      Object.assign(existing, payload)
      return { data: [existing], error: null }
    }
    const row: Row = { id: nextId(this.table.name), ...payload }
    this.table.rows.push(row)
    return { data: [row], error: null }
  }

  async maybeSingle() {
    const failed = this.failureOf()
    if (failed) return failed
    const { data } = this.resolve()
    return { data: data[0] ?? null, error: null }
  }

  async single() {
    const failed = this.failureOf()
    if (failed) return failed
    const { data } = this.resolve()
    if (!data[0]) return { data: null, error: { message: `no matching row in ${this.table.name}` } }
    return { data: data[0], error: null }
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const failed = this.failureOf()
    if (failed) return Promise.resolve(failed).then(onfulfilled as never, onrejected)
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected)
  }
}

type RpcResult = { data: unknown; error: { message: string } | null }
type RpcHandler = (args?: Record<string, unknown>) => RpcResult | Promise<RpcResult>

export interface FakeClient {
  from(table: string): FakeQueryBuilder
  tableRows(table: string): Row[]
  rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult>
  /**
   * Make one table answer every query with a Postgres-style error, so the
   * `if (error) throw` branches can be reached. See `FakeTable.failure`.
   */
  failTable(table: string, message: string): void
}

/**
 * A fake client seeded with starting rows per table, by name, and — for the
 * plpgsql functions no table can stand in for — a handler per RPC name.
 */
export function makeFakeClient(seed: Record<string, Row[]> = {}, rpcHandlers: Record<string, RpcHandler> = {}): FakeClient {
  const tables = new Map<string, FakeTable>()
  for (const [name, rows] of Object.entries(seed)) {
    const table = new FakeTable(name)
    table.rows = rows.map((row) => ({ ...row }))
    tables.set(name, table)
  }

  return {
    from(name: string) {
      if (!tables.has(name)) tables.set(name, new FakeTable(name))
      return new FakeQueryBuilder(tables.get(name)!)
    },
    tableRows(name: string) {
      return tables.get(name)?.rows ?? []
    },
    /** Make one table answer every query with a Postgres-style error. */
    failTable(name: string, message: string) {
      if (!tables.has(name)) tables.set(name, new FakeTable(name))
      tables.get(name)!.failure = message
    },
    async rpc(name: string, args?: Record<string, unknown>) {
      const handler = rpcHandlers[name]
      if (!handler) throw new Error(`fakeSupabase: no rpc handler registered for "${name}"`)
      return handler(args)
    },
  }
}
