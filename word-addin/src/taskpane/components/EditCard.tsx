import { useState } from 'react'
import type { ProposedEdit } from '../../word/editTypes'
import type { EditOutcome } from '../../word/applyTrackedEdits'
import { resolveTrackedEdit, revealTrackedEdit } from '../../word/trackedChanges'

/**
 * One reviewable revision.
 *
 * Every outcome is shown, including the failures. An edit the model proposed
 * but Word could not place is the single most useful thing to surface — silently
 * dropping it would let the attorney believe a change was made.
 */
export default function EditCard({
  edit,
  outcome,
}: {
  edit: ProposedEdit
  outcome?: EditOutcome
}) {
  const [resolved, setResolved] = useState<'accept' | 'reject' | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const decide = async (decision: 'accept' | 'reject') => {
    if (!outcome?.bookmark) return
    const result = await resolveTrackedEdit(outcome.bookmark, decision)
    if (result.ok) {
      setResolved(decision)
      return
    }
    setNote(
      result.reason === 'anchor-lost'
        ? 'That passage has moved. Use Word’s Review tab for this one.'
        : result.reason === 'no-revisions'
          ? 'Already resolved in Word.'
          : (result.detail ?? 'Word could not resolve this change.'),
    )
  }

  const status = outcome?.status ?? 'error'
  const applied = status === 'applied'

  return (
    <div className="rounded border border-[color:var(--color-line)] p-2">
      {edit.reason && <p className="font-medium">{edit.reason}</p>}

      <div className="mt-1 space-y-0.5 font-mono text-[11px]">
        <p className="text-red-700 line-through">{edit.original}</p>
        {edit.replacement ? <p className="text-green-700">{edit.replacement}</p> : null}
        {edit.formats?.length ? (
          <p className="text-[color:var(--color-ink-muted)]">
            formatting: {edit.formats.join(', ')}
          </p>
        ) : null}
      </div>

      <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)]">
        {applied && !resolved && 'Applied as a tracked change.'}
        {resolved === 'accept' && 'Accepted.'}
        {resolved === 'reject' && 'Rejected.'}
        {status === 'not-found' &&
          'Not applied — that exact text is not in the document.'}
        {status === 'ambiguous' &&
          `Not applied — ${outcome?.matches} passages match, so the target is unclear.`}
        {status === 'skipped' &&
          (outcome?.detail === 'pre-existing-revisions'
            ? 'Not applied — that passage already carries a tracked change.'
            : `Not applied — ${outcome?.detail}`)}
        {status === 'error' && `Not applied — ${outcome?.detail ?? 'Word rejected the edit.'}`}
      </p>

      {applied && outcome?.deletedRevisionMissing && (
        <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)]">
          Word reported only the insertion for this change. Check it in the Review tab.
        </p>
      )}

      {note && <p className="mt-1 text-[11px] text-red-600">{note}</p>}

      {applied && !resolved && outcome?.bookmark && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => void decide('accept')}
            className="rounded border border-[color:var(--color-line)] px-2 py-0.5"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => void decide('reject')}
            className="rounded border border-[color:var(--color-line)] px-2 py-0.5"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => void revealTrackedEdit(outcome.bookmark!)}
            className="rounded px-2 py-0.5 text-[color:var(--color-ink-muted)] underline"
          >
            Show
          </button>
        </div>
      )}
    </div>
  )
}
