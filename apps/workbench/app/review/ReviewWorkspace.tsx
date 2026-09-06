'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@aubrey-law/ui/button'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { ReviewResult } from '@aubrey-law/citations/review/types'
import { isCitable } from '@/lib/review/order'
import { BlockTextViewer } from './BlockTextViewer'
import { FindingsList, type Disposition } from './FindingsList'
import { PdfCitationViewer } from '@aubrey-law/citations/react/PdfCitationViewer'

export interface ReviewableChoice {
  versionId: string
  name: string
  kind: 'docx' | 'pdf'
}

export interface RunSummaryChoice {
  runId: string
  matterTitle: string
  documentName: string
  status: string
  findingCount: number
  failedCount: number
  finishedAt: string | null
}

export interface MatterChoice {
  matterId: string
  title: string
  documents: ReviewableChoice[]
}

interface PlaybookSummary {
  title: string
  version: number
  rules: Array<{ number: string; risk: string; statement: string }>
}

interface ReviewResponse {
  filename: string
  anchor: { documentVersionId: string; documentId: string; matterId: string } | null
  runId: string | null
  saveError: string | null
  playbook: { slug: string; title: string; version: number }
  layer: TextLayer
  /**
   * Present only for the ephemeral upload path (`app/api/staff/review/route.ts`):
   * an upload with no filed version to anchor to still runs the playbook
   * inline and returns its result in the same response. A filed document's
   * review is queued instead — `queued: true` below, and no `result` at
   * all, since nothing has run yet. `onSubmit` never stores a queued
   * response in `review`; this field is typed optional anyway, so a future
   * caller of `setReview` cannot reintroduce the crash that not checking for
   * it once caused (`review.result.findings` throwing for a queued run).
   */
  result?: ReviewResult
  queued?: boolean
}

export function ReviewWorkspace({
  playbook,
  matters,
  runs = [],
}: {
  playbook: PlaybookSummary
  matters: MatterChoice[]
  runs?: RunSummaryChoice[]
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [matterId, setMatterId] = useState(matters[0]?.matterId ?? '')
  const [versionId, setVersionId] = useState(matters[0]?.documents[0]?.versionId ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewResponse | null>(null)
  /** Held in the browser for the PDF viewer; never uploaded twice. */
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dispositions, setDispositions] = useState<Partial<Record<string, Disposition>>>({})

  const onSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const file = fileRef.current?.files?.[0]
    // A filed document wins over an upload: it carries a real version id, which
    // is what a citation can be anchored to.
    const chosen = file ? null : versionId
    if (!file && !chosen) {
      setError('Choose a document to review.')
      return
    }

    setPending(true)
    setError(null)
    setReview(null)
    setSelected(null)
    setDispositions({})
    // Read for the viewer before the upload consumes the stream, so a PDF can
    // be rendered from the copy already in the browser rather than fetched back.
    // Only an upload can supply its own bytes for the viewer; a filed document
    // is read server-side, and its PDF view arrives with the layer.
    setPdfBytes(file && file.name.toLowerCase().endsWith('.pdf') ? await file.arrayBuffer() : null)

    const body = new FormData()
    if (file) body.set('document', file)
    else body.set('documentVersionId', chosen as string)

    try {
      const response = await fetch('/api/staff/review', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) {
        setError(typeof payload?.error === 'string' ? payload.error : 'The review could not be run.')
        return
      }
      // A filed document's review is queued, not run in this request — see
      // the `ReviewResponse.queued` comment. There is no result to show yet;
      // the run's own page (`/review/[runId]`) is what will show it,
      // refreshing itself until the run settles. Sending the browser there
      // beats rendering this workspace as though a result had arrived.
      if (payload?.queued && payload?.runId) {
        router.push(`/review/${payload.runId}`)
        return
      }
      setReview(payload as ReviewResponse)
    } catch {
      setError('The review could not be reached. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }, [router, versionId])

  const citation: Citation | null = useMemo(() => {
    if (!review?.result || selected === null) return null
    const finding = review.result.findings.find((f) => f.ruleNumber === selected)
    return finding && isCitable(finding) ? finding.citation : null
  }, [review, selected])

  const counts = useMemo(() => {
    const findings = review?.result?.findings ?? []
    return {
      total: findings.length,
      cited: findings.filter(isCitable).length,
      refused: findings.filter((f) => f.citationRefusal !== null).length,
      failed: review?.result?.failures.length ?? 0,
    }
  }, [review])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <Link href="/" className="text-xs text-muted-foreground underline underline-offset-4">
            Workbench
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Review a draft</h1>
        </div>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          {matters.length > 0 ? (
            <>
              <select
                aria-label="Matter"
                value={matterId}
                onChange={(event) => {
                  setMatterId(event.target.value)
                  const next = matters.find((m) => m.matterId === event.target.value)
                  setVersionId(next?.documents[0]?.versionId ?? '')
                }}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {matters.map((matter) => (
                  <option key={matter.matterId} value={matter.matterId}>
                    {matter.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Document"
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                className="h-9 max-w-64 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                {(matters.find((m) => m.matterId === matterId)?.documents ?? []).map((document) => (
                  <option key={document.versionId} value={document.versionId}>
                    {document.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">or upload</span>
            </>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            name="document"
            accept=".pdf,.docx"
            aria-label="Document to review"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Reviewing…' : 'Run review'}
          </Button>
        </form>
      </header>

      {error ? (
        <p role="alert" className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      ) : null}

      {!review || !review.result ? (
        <section className="mx-auto w-full max-w-2xl space-y-4 px-6 py-10">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{playbook.title}</h2>
            <p className="text-xs text-muted-foreground">
              Version {playbook.version} · {playbook.rules.length} rules. Each is checked separately
              against the document, and every quote is verified against the text before it becomes a
              citation.
            </p>
          </div>
          <ol className="space-y-3">
            {playbook.rules.map((rule) => (
              <li key={rule.number} className="text-sm">
                <span className="font-medium">Rule {rule.number}</span>{' '}
                <span className="text-muted-foreground">({rule.risk})</span>
                <p className="text-muted-foreground">{rule.statement}</p>
              </li>
            ))}
          </ol>
          <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            A review of a document filed on a matter is recorded and can be returned to. An uploaded
            draft is not, because there is no filed version for its citations to point at.
          </p>

          {runs.length > 0 ? (
            <div className="space-y-2" data-testid="run-history">
              <h2 className="text-sm font-semibold">Recorded reviews</h2>
              <ul className="divide-y divide-border border-y border-border">
                {runs.map((run) => (
                  <li key={run.runId}>
                    <Link
                      href={`/review/${run.runId}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm hover:bg-muted/50"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{run.documentName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{run.matterTitle}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {run.findingCount} findings
                        {run.failedCount > 0 ? ` · ${run.failedCount} rules failed` : ''}
                        {run.status === 'partial' ? ' · partial' : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-2">
          <section className="border-b border-border lg:border-b-0 lg:border-r">
            <div className="space-y-1 border-b border-border px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">{counts.total} findings</h2>
                <p className="text-xs text-muted-foreground">
                  {counts.cited} cited · {counts.refused} citations rejected
                  {counts.failed > 0 ? ` · ${counts.failed} rules failed` : ''}
                </p>
              </div>
              {/* Whether this review exists anywhere but on screen. A review the
                  attorney believes was recorded and was not is worse than one
                  they know was not. */}
              <p className="text-xs" data-testid="save-state">
                {review.saveError ? (
                  <span className="text-destructive">
                    Not recorded: {review.saveError}
                  </span>
                ) : review.runId ? (
                  <span className="text-muted-foreground">
                    Recorded.{' '}
                    <Link href={`/review/${review.runId}`} className="underline underline-offset-4">
                      Open the saved review
                    </Link>
                    .
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Not recorded — an uploaded draft has no filed version to anchor citations to.
                    Choose the document from its matter to keep the review.
                  </span>
                )}
              </p>
            </div>
            <FindingsList
              findings={review.result.findings}
              selected={selected}
              onSelect={setSelected}
              dispositions={dispositions}
              onDispose={(ruleNumber, disposition) =>
                setDispositions((current) => ({
                  ...current,
                  [ruleNumber]: current[ruleNumber] === disposition ? undefined : disposition,
                }))
              }
            />
            {review.result.failures.length > 0 ? (
              <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Rules that did not run</p>
                {/* Named rather than folded into the count: a rule that never
                    ran is not a rule that found nothing. */}
                <ul className="mt-1 space-y-0.5">
                  {review.result.failures.map((failure) => (
                    <li key={failure.ruleNumber}>
                      Rule {failure.ruleNumber} — {failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="overflow-auto">
            <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="truncate text-sm font-semibold">{review.filename}</h2>
              <p className="shrink-0 text-xs text-muted-foreground">
                {review.layer.sourceKind.toUpperCase()} · {review.layer.blocks.length} paragraphs
                {review.layer.pageCount ? ` · ${review.layer.pageCount} pages` : ''}
              </p>
            </div>
            {review.layer.sourceKind === 'pdf' && pdfBytes ? (
              <PdfCitationViewer bytes={pdfBytes} layer={review.layer} citation={citation} />
            ) : (
              <BlockTextViewer layer={review.layer} citation={citation} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}
