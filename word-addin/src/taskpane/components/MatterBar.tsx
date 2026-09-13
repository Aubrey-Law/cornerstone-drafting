import { useEffect, useState } from 'react'
import {
  getMatterBrief,
  listMatters,
  type MatterBrief,
  type MatterSummary,
} from '../api/client'
import type { LinkedMatter } from '../matter/link'

/**
 * The matter this document is being drafted against.
 *
 * Collapsed to one line most of the time — an attorney drafting knows which
 * client they are working for, and the bar's job is to let them confirm it at a
 * glance, not to occupy the pane. It opens for two things: choosing a matter,
 * and reading what the design sheet actually says.
 */
export default function MatterBar({
  linked,
  onLink,
  onUnlink,
}: {
  linked: LinkedMatter | null
  onLink: (matter: LinkedMatter) => void
  onUnlink: () => void
}) {
  const [picking, setPicking] = useState(false)

  if (picking) {
    return (
      <MatterPicker
        onCancel={() => setPicking(false)}
        onPick={matter => {
          onLink(matter)
          setPicking(false)
        }}
      />
    )
  }

  return (
    <div className="border-b border-[color:var(--color-line)] px-3 py-2">
      {linked ? (
        <LinkedRow linked={linked} onChange={() => setPicking(true)} onUnlink={onUnlink} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[color:var(--color-ink-muted)]">
            Drafting from the document only.
          </span>
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="shrink-0 rounded border border-[color:var(--color-line)] px-2 py-1 text-xs"
          >
            Link a matter
          </button>
        </div>
      )}
    </div>
  )
}

function LinkedRow({
  linked,
  onChange,
  onUnlink,
}: {
  linked: LinkedMatter
  onChange: () => void
  onUnlink: () => void
}) {
  const [showSheet, setShowSheet] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{linked.clientName}</div>
          {linked.matterNumber && (
            <div className="text-[11px] text-[color:var(--color-ink-muted)]">
              {linked.matterNumber}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 text-xs">
          <button type="button" onClick={() => setShowSheet(v => !v)} className="underline">
            {showSheet ? 'Hide sheet' : 'Design sheet'}
          </button>
          <button type="button" onClick={onChange} className="underline">
            Change
          </button>
          <button
            type="button"
            onClick={onUnlink}
            className="text-[color:var(--color-ink-muted)] underline"
          >
            Unlink
          </button>
        </div>
      </div>
      {showSheet && <DesignSheetView matterId={linked.id} />}
    </div>
  )
}

/**
 * The design sheet as the model receives it.
 *
 * Shown verbatim rather than prettified, because its value to the attorney is
 * precisely the `[UNKNOWN]` lines: this is the moment to notice that the
 * successor trustee was never decided, before a draft is built that reads as
 * though it was.
 */
function DesignSheetView({ matterId }: { matterId: string }) {
  const [brief, setBrief] = useState<MatterBrief | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setBrief(null)
    setError(null)
    getMatterBrief(matterId)
      .then(result => {
        if (live) setBrief(result)
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load the design sheet.')
      })
    return () => {
      live = false
    }
  }, [matterId])

  if (error) return <p className="text-red-600">{error}</p>
  if (!brief) return <p className="text-[color:var(--color-ink-muted)]">Loading the design sheet…</p>

  const unknowns = brief.factSheet.match(/\[UNKNOWN\]/g)?.length ?? 0

  return (
    <div className="space-y-1">
      {unknowns > 0 && (
        <p className="text-[11px] text-amber-700">
          {unknowns} value{unknowns === 1 ? '' : 's'} not yet decided. The assistant leaves these
          as placeholders rather than guessing.
        </p>
      )}
      <pre className="max-h-64 overflow-auto rounded bg-[color:var(--color-surface-sunken)] p-2 text-[11px] whitespace-pre-wrap">
        {brief.factSheet}
      </pre>
    </div>
  )
}

function MatterPicker({
  onPick,
  onCancel,
}: {
  onPick: (matter: LinkedMatter) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<MatterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * Debounced, and every in-flight response is checked against the query that
   * is current when it lands. Without that second guard a slow response for
   * "sm" can arrive after a fast one for "smith" and repopulate the list with
   * the wrong matters — the classic out-of-order search bug, and one that here
   * would offer the wrong client for a legal document.
   */
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      setError(null)
      listMatters(query)
        .then(result => {
          if (live) setRows(result.matters)
        })
        .catch((err: unknown) => {
          if (live) setError(err instanceof Error ? err.message : 'Could not load matters.')
        })
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="space-y-2 border-b border-[color:var(--color-line)] px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search matters…"
          aria-label="Search matters"
          autoFocus
          className="min-w-0 flex-1 rounded border border-[color:var(--color-line)] px-2 py-1"
        />
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 text-xs text-[color:var(--color-ink-muted)] underline"
        >
          Cancel
        </button>
      </div>

      {error && <p className="text-red-600">{error}</p>}
      {!rows && !error && <p className="text-[color:var(--color-ink-muted)]">Loading…</p>}
      {rows?.length === 0 && (
        <p className="text-[color:var(--color-ink-muted)]">
          No matters match. The list covers matters in the drafting stages.
        </p>
      )}

      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {rows?.map(row => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() =>
                onPick({
                  id: row.id,
                  matterNumber: row.matterNumber,
                  clientName: row.clientName,
                })
              }
              className="w-full rounded px-2 py-1 text-left hover:bg-[color:var(--color-surface-sunken)]"
            >
              <div className="truncate font-medium">{row.clientName}</div>
              <div className="truncate text-[11px] text-[color:var(--color-ink-muted)]">
                {[row.matterNumber, row.planType, row.stage].filter(Boolean).join(' · ')}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
