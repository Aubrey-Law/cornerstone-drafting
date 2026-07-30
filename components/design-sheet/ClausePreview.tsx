'use client'

import { useEffect, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type {
  ClausePreviewClause,
  ClausePreviewPart,
} from '@/lib/estateGenerator/clausePreview'
import type { DesignSheet } from '@/types/database'

interface ClausePreviewProps {
  matterId: string
  sheet: DesignSheet
}

function ClausePart({ part }: { part: ClausePreviewPart }) {
  if (part.kind === 'value') {
    return <span className="font-semibold text-[var(--gi-teal)]">{part.text}</span>
  }
  if (part.kind === 'hole') {
    return (
      <span className="rounded-sm border border-[var(--gi-amber-border)] bg-[var(--gi-amber-bg)] px-1 text-[var(--gi-amber)]">
        [ {part.label} ]
      </span>
    )
  }
  return <>{part.text}</>
}

export function ClausePreview({ matterId, sheet }: ClausePreviewProps) {
  const accessToken = useAccessToken()
  const [clauses, setClauses] = useState<ClausePreviewClause[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!accessToken) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      void fetch(`/api/admin/matters/${matterId}/design-sheet/clause-preview`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sheet }),
        signal: controller.signal,
      })
        .then(async response => {
          const data = await response.json().catch(() => ({})) as {
            clauses?: ClausePreviewClause[]
            error?: string
          }
          if (!response.ok) throw new Error(data.error || 'Unable to build clause preview')
          setClauses(data.clauses ?? [])
          setError(null)
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to build clause preview')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [accessToken, matterId, sheet])

  return (
    <div className="h-full overflow-y-auto bg-muted/20 px-4 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Clause preview</h2>
          <p className="text-[11px] text-muted-foreground">Live drafting language · read only</p>
        </div>
        {loading ? <span className="text-[10px] text-muted-foreground">Updating…</span> : null}
      </div>

      {error ? (
        <div className="rounded-md border border-[var(--gi-amber-border)] bg-[var(--gi-amber-bg)] p-3 text-xs text-[var(--gi-amber)]">
          {error}
        </div>
      ) : null}

      {!error && !loading && clauses.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          Choose plan documents to see their clauses here.
        </p>
      ) : null}

      <div className="space-y-3">
        {clauses.map(clause => (
          <article key={clause.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gi-teal)]">
              {clause.document}
            </p>
            <h3 className="mt-0.5 text-xs font-semibold text-foreground">{clause.section}</h3>
            <p
              className="mt-3 text-[15px] leading-6 text-foreground"
              style={{ fontFamily: 'var(--font-eb-garamond), Georgia, serif' }}
            >
              {clause.parts.map((part, index) => <ClausePart key={`${clause.id}-${index}`} part={part} />)}
            </p>
            {clause.annotation ? (
              <p className="mt-3 border-t border-border pt-2 text-[11px] leading-4 text-[var(--gi-amber)]">
                {clause.annotation}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
