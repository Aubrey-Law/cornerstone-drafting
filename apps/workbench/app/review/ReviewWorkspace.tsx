'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@aubrey-law/ui/button'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { ReviewResult } from '@aubrey-law/citations/review/types'
import { isCitable } from '@/lib/review/order'
import { BlockTextViewer } from './BlockTextViewer'
import { FindingsList, type Disposition } from './FindingsList'
import { PdfCitationViewer } from '@aubrey-law/citations/react/PdfCitationViewer'

interface PlaybookSummary {
  title: string
  version: number
  rules: Array<{ number: string; risk: string; statement: string }>
}

interface ReviewResponse {
  filename: string
  playbook: { slug: string; title: string; version: number }
  layer: TextLayer
  result: ReviewResult
}

export function ReviewWorkspace({ playbook }: { playbook: PlaybookSummary }) {
  const fileRef = useRef<HTMLInputElement>(null)
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
    if (!file) {
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
    setPdfBytes(file.name.toLowerCase().endsWith('.pdf') ? await file.arrayBuffer() : null)

    const body = new FormData()
    body.set('document', file)

    try {
      const response = await fetch('/api/staff/review', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) {
        setError(typeof payload?.error === 'string' ? payload.error : 'The review could not be run.')
        return
      }
      setReview(payload as ReviewResponse)
    } catch {
      setError('The review could not be reached. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }, [])

  const citation: Citation | null = useMemo(() => {
    if (!review || selected === null) return null
    const finding = review.result.findings.find((f) => f.ruleNumber === selected)
    return finding && isCitable(finding) ? finding.citation : null
  }, [review, selected])

  const counts = useMemo(() => {
    const findings = review?.result.findings ?? []
    return {
      total: findings.length,
      cited: findings.filter(isCitable).length,
      refused: findings.filter((f) => f.citationRefusal !== null).length,
      failed: review?.result.failures.length ?? 0,
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

      {!review ? (
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
            Nothing is saved. The document is read, reviewed and discarded, so this can be pointed at
            a draft from another firm before anything is decided about it — and closing this tab
            discards the findings with it.
          </p>
        </section>
      ) : (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-2">
          <section className="border-b border-border lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">{counts.total} findings</h2>
              <p className="text-xs text-muted-foreground">
                {counts.cited} cited · {counts.refused} citations rejected
                {counts.failed > 0 ? ` · ${counts.failed} rules failed` : ''}
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
