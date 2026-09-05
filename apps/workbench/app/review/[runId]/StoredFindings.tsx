'use client'

import { useActionState, useOptimistic, useState } from 'react'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'
import { isCitable, orderFindings } from '@/lib/review/order'
import type { Disposition, StoredFinding } from '@/lib/review/persist'
import { BlockTextViewer } from '@/app/review/BlockTextViewer'
import { FindingsList } from '@/app/review/FindingsList'
import { recordDisposition } from './actions'

/**
 * A recorded review, read back.
 *
 * The document is rendered from the run's own stored text layer rather than
 * re-fetched, so a past review highlights exactly what it highlighted on the
 * day — the offsets and the text they index travelled together. A PDF's page
 * geometry is not used here; the block view is exact for both formats and needs
 * nothing from storage.
 */
export function StoredFindings({
  runId,
  findings,
  layer,
}: {
  runId: string
  findings: StoredFinding[]
  layer: TextLayer | null
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [state, submit] = useActionState(recordDisposition, { message: null })

  // Shown immediately, so a decision does not appear to be ignored while the
  // round trip completes.
  const [optimistic, setOptimistic] = useOptimistic(
    Object.fromEntries(findings.map((f) => [f.ruleNumber, f.disposition])) as Record<string, Disposition>,
  )

  const byRule = new Map(findings.map((f) => [f.ruleNumber, f]))

  /**
   * `open` is the absence of a decision, so it is shown as no button pressed
   * rather than as a fourth state. The stored vocabulary needs it — a reopened
   * finding has to be distinguishable from one never looked at only by its
   * cleared timestamp — but the buttons offer the three real choices.
   */
  const pressed = Object.fromEntries(
    Object.entries(optimistic).filter(([, disposition]) => disposition !== 'open'),
  ) as Partial<Record<string, 'accepted' | 'rejected' | 'deferred'>>

  const citation: Citation | null = (() => {
    if (selected === null) return null
    const finding = byRule.get(selected)
    return finding && isCitable(finding) ? finding.citation : null
  })()

  return (
    <div className="grid flex-1 grid-cols-1 lg:grid-cols-2">
      <section className="border-b border-border lg:border-b-0 lg:border-r">
        {state.message ? (
          <p role="alert" className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {state.message}
          </p>
        ) : null}
        <FindingsList
          findings={orderFindings(findings)}
          selected={selected}
          onSelect={setSelected}
          dispositions={pressed}
          onDispose={(ruleNumber, disposition) => {
            const finding = byRule.get(ruleNumber)
            if (!finding) return
            // Clicking the recorded decision again reopens it.
            const next = optimistic[ruleNumber] === disposition ? 'open' : disposition
            const form = new FormData()
            form.set('findingId', finding.findingId)
            form.set('disposition', next)
            form.set('runId', runId)
            setOptimistic({ ...optimistic, [ruleNumber]: next })
            submit(form)
          }}
        />
      </section>
      <section className="overflow-auto">
        {layer ? (
          <BlockTextViewer layer={layer} citation={citation} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            This run recorded no text layer, so its citations cannot be shown against the document.
          </p>
        )}
      </section>
    </div>
  )
}
