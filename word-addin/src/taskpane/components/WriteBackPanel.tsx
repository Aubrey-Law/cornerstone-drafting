import { useState } from 'react'
import {
  applyDesignSheet,
  proposeDesignSheet,
  type DesignSheetProposal,
  type ProposedFieldRow,
} from '../api/client'
import { readDocument } from '../../word/readDocument'

type Phase = 'idle' | 'reading' | 'reviewing' | 'saving' | 'saved'

/**
 * Decisions settled in Word, written back to the design sheet.
 *
 * The counterpart to drafting from the sheet: an attorney who names a successor
 * trustee while redlining has, until now, had to re-key it on the design sheet or
 * leave the two disagreeing. The sheet is the firm's record, so nothing here is
 * automatic — the document is read, every change is shown old-value → new-value,
 * and only ticked rows are written.
 *
 * Rows that would overwrite an existing value arrive unticked from the server
 * (`selected: !replacement`). That default is the point: filling a blank is
 * routine, changing a decision the attorney already recorded is not, and the
 * quiet version of that mistake is the one nobody catches.
 */
export default function WriteBackPanel({ matterId }: { matterId: string | null }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [proposal, setProposal] = useState<DesignSheetProposal | null>(null)
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (!matterId) {
    return (
      <p className="p-3 text-[color:var(--color-ink-muted)]">
        Link a matter above to write decisions back to its design sheet.
      </p>
    )
  }

  const read = async () => {
    setPhase('reading')
    setError(null)
    setMessage(null)
    setProposal(null)
    try {
      const snapshot = await readDocument()
      const result = await proposeDesignSheet(matterId, snapshot.markdown)
      setProposal(result)
      setTicked(Object.fromEntries(result.preview.map(row => [row.field, row.selected])))
      setPhase(result.preview.length > 0 ? 'reviewing' : 'idle')
      // Only when there is genuinely nothing to report. A document with no
      // applicable rows but some rejected ones did say something — the list
      // below is the answer, and "nothing maps" would contradict it.
      if (result.preview.length === 0 && result.rejected.length === 0) {
        setMessage('Nothing in this document maps to a design-sheet field.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the document.')
      setPhase('idle')
    }
  }

  const save = async () => {
    if (!proposal) return
    const fields: Record<string, unknown> = {}
    for (const row of proposal.preview) {
      if (ticked[row.field]) fields[row.field] = proposal.proposed[row.field]
    }
    if (Object.keys(fields).length === 0) {
      setError('Tick at least one change to save.')
      return
    }

    setPhase('saving')
    setError(null)
    try {
      const result = await applyDesignSheet(matterId, {
        sheetId: proposal.sheetId,
        expectedUpdatedAt: proposal.updatedAt,
        fields,
      })
      setMessage(
        `Saved ${result.appliedFields} change${result.appliedFields === 1 ? '' : 's'} to the design sheet.`,
      )
      // Cleared rather than left on screen: the rows now describe a sheet that has
      // changed, and re-saving them would be a write against a stale token.
      setProposal(null)
      setPhase('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save to the design sheet.')
      setPhase('reviewing')
    }
  }

  const busy = phase === 'reading' || phase === 'saving'
  const tickedCount = proposal
    ? proposal.preview.filter(row => ticked[row.field]).length
    : 0

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[color:var(--color-ink-muted)]">
          Read this document for decisions and update the design sheet.
        </p>
        <button
          type="button"
          onClick={() => void read()}
          disabled={busy}
          className="shrink-0 rounded border border-[color:var(--color-line)] px-3 py-1 disabled:opacity-50"
        >
          {phase === 'reading' ? 'Reading…' : proposal ? 'Re-read' : 'Read document'}
        </button>
      </div>

      {message && <p className="text-[color:var(--color-ink-muted)]">{message}</p>}
      {error && <p className="text-red-600">{error}</p>}

      {proposal && proposal.preview.length > 0 && (
        <>
          <ul className="space-y-2">
            {proposal.preview.map(row => (
              <ProposedRow
                key={row.field}
                row={row}
                checked={Boolean(ticked[row.field])}
                onToggle={() =>
                  setTicked(prev => ({ ...prev, [row.field]: !prev[row.field] }))
                }
              />
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-line)] pt-2">
            <span className="text-[11px] text-[color:var(--color-ink-muted)]">
              {tickedCount} of {proposal.preview.length} selected
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || tickedCount === 0}
              className="rounded bg-[color:var(--color-accent)] px-3 py-1 font-medium text-white disabled:opacity-40"
            >
              {phase === 'saving' ? 'Saving…' : 'Save to design sheet'}
            </button>
          </div>
        </>
      )}

      {proposal && proposal.rejected.length > 0 && (
        <div className="space-y-1 border-t border-[color:var(--color-line)] pt-2">
          <p className="text-[11px] font-medium">Not applied</p>
          {/*
            Shown rather than dropped: "the document said something this field
            cannot hold" is a different fact from "the document said nothing",
            and only the first is worth the attorney's attention.
          */}
          {proposal.rejected.map(row => (
            <p key={row.field} className="text-[11px] text-[color:var(--color-ink-muted)]">
              <span className="font-medium">{row.label}:</span> “{row.value}” is not one of{' '}
              {row.options.join(', ')}.
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function ProposedRow({
  row,
  checked,
  onToggle,
}: {
  row: ProposedFieldRow
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`rounded border p-2 ${
        row.replacement
          ? 'border-amber-300 bg-amber-50'
          : 'border-[color:var(--color-line)]'
      }`}
    >
      <label className="flex gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium">{row.label}</span>
          <span className="block text-[11px] text-[color:var(--color-ink-muted)]">
            {row.section}
          </span>
          {row.replacement ? (
            <span className="mt-1 block break-words">
              <s className="text-[color:var(--color-ink-muted)]">{row.currentDisplay}</s>{' '}
              → {row.proposedDisplay}
              <span className="mt-1 block text-[11px] text-amber-700">
                Replaces a value already on the sheet.
              </span>
            </span>
          ) : (
            <span className="mt-1 block break-words">{row.proposedDisplay}</span>
          )}
        </span>
      </label>
    </li>
  )
}
