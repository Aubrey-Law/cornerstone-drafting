import { useState } from 'react'
import { applyStyleSweep } from '../../word/formatting/styleSweep'
import {
  applyContentPasses,
  previewContentPasses,
  type FormattingPreview,
} from '../../word/formatting/runPasses'
import { postStyleSweep } from '../api/client'

type Phase = 'idle' | 'working' | 'previewed'

/**
 * The firm formatting pass, in two halves that work very differently.
 *
 * The style sweep round-trips the document through the server so it reuses the
 * same engine that formats generated documents. The content passes run here in
 * Office.js, because they restructure paragraphs — which no part-level XML
 * rewrite can do.
 */
export default function FormatPanel() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [preview, setPreview] = useState<FormattingPreview | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runStyleSweep = async () => {
    setPhase('working')
    setError(null)
    setMessage(null)
    try {
      const result = await applyStyleSweep(postStyleSweep)
      setMessage(
        result.noOp
          ? 'The document already matches the firm style set.'
          : `Firm style applied (${result.changedParts.length} document parts updated). Ctrl+Z undoes it.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the firm style.')
    } finally {
      setPhase('idle')
    }
  }

  const runPreview = async () => {
    setPhase('working')
    setError(null)
    setMessage(null)
    try {
      const result = await previewContentPasses()
      setPreview(result)
      setPhase(result.totalEdits > 0 ? 'previewed' : 'idle')
      if (result.totalEdits === 0) setMessage('Nothing to change — the structure already matches.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the document.')
      setPhase('idle')
    }
  }

  const applyPreview = async () => {
    if (!preview) return
    setPhase('working')
    setError(null)
    try {
      const result = await applyContentPasses(preview.passes)
      setMessage(
        `${result.applied} change${result.applied === 1 ? '' : 's'} applied as tracked changes.` +
          (result.staleDocument
            ? ' Some were skipped because the document changed since the preview — run it again.'
            : result.failed > 0
              ? ` ${result.failed} could not be applied.`
              : ''),
      )
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply the changes.')
    } finally {
      setPhase('idle')
    }
  }

  const busy = phase === 'working'

  return (
    <div className="space-y-4 p-3">
      <section className="space-y-2">
        <h2 className="font-semibold">Firm style</h2>
        <p className="text-[color:var(--color-ink-muted)]">
          Font, title sizes, subsection indents, and page setup — the same rules the
          generator applies. This replaces the whole document in one step; Ctrl+Z undoes it.
        </p>
        <button
          type="button"
          onClick={() => void runStyleSweep()}
          disabled={busy}
          className="rounded bg-[color:var(--color-accent)] px-3 py-1 font-medium text-white disabled:opacity-40"
        >
          Apply firm style
        </button>
      </section>

      <hr className="border-[color:var(--color-line)]" />

      <section className="space-y-2">
        <h2 className="font-semibold">Structure passes</h2>
        <p className="text-[color:var(--color-ink-muted)]">
          Article titles onto their own line, notary blocks standardized, section intros run
          into their headings. Preview first — these read the text, so they can misjudge an
          unusual document. Applied as tracked changes.
        </p>

        {phase !== 'previewed' && (
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={busy}
            className="rounded border border-[color:var(--color-line)] px-3 py-1 font-medium disabled:opacity-40"
          >
            Preview changes
          </button>
        )}

        {preview && phase === 'previewed' && (
          <div className="space-y-2">
            {preview.passes.map(pass => (
              <details key={pass.id} className="rounded border border-[color:var(--color-line)] p-2">
                <summary className="cursor-pointer font-medium">
                  {pass.label} — {pass.edits.length}
                </summary>
                <ul className="mt-2 space-y-2">
                  {pass.edits.slice(0, 20).map((edit, i) => (
                    <li key={i} className="font-mono text-[11px]">
                      <p className="text-red-700 line-through">{edit.before}</p>
                      <p className="text-green-700">{edit.after}</p>
                      {edit.insertAfter?.map((extra, j) => (
                        <p key={j} className="text-green-700">
                          + {extra.text}
                        </p>
                      ))}
                    </li>
                  ))}
                  {pass.edits.length > 20 && (
                    <li className="text-[color:var(--color-ink-muted)]">
                      …and {pass.edits.length - 20} more
                    </li>
                  )}
                </ul>
              </details>
            ))}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void applyPreview()}
                disabled={busy}
                className="rounded bg-[color:var(--color-accent)] px-3 py-1 font-medium text-white disabled:opacity-40"
              >
                Apply {preview.totalEdits}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null)
                  setPhase('idle')
                }}
                className="rounded border border-[color:var(--color-line)] px-3 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {busy && <p className="text-[color:var(--color-ink-muted)]">Working…</p>}
      {message && <p>{message}</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
