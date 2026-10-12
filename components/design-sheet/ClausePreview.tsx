'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type {
  ClausePreviewClause,
  ClausePreviewPart,
} from '@/lib/estateGenerator/clausePreview'
import type { DesignSheet } from '@/types/database'

export interface ClausePreviewStatus {
  count: number
  error: string | null
  loading: boolean
}

interface ClausePreviewProps {
  matterId: string
  sheet: DesignSheet
  /** Reports whether any clause text exists so the column can stay unmounted. */
  onStatus?: (status: ClausePreviewStatus) => void
  /** Host for the preview. With no clause text, nothing is rendered. */
  mount?: HTMLElement | null
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

export function ClausePreview({ matterId, sheet, onStatus, mount = null }: ClausePreviewProps) {
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
          setClauses([])
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

  useEffect(() => {
    onStatus?.({ count: clauses.length, error, loading })
  }, [clauses.length, error, loading, onStatus])

  if (loading || error || clauses.length === 0 || !mount) return null

  return createPortal(
    <div className="h-full overflow-y-auto bg-muted px-4 py-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">Clause preview</h2>
        <p className="text-micro text-muted-foreground">Live drafting language · read only</p>
      </div>

      <div className="space-y-3">
        {clauses.map(clause => (
          <article key={clause.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <p className="text-micro font-semibold uppercase tracking-[0.1em] text-[var(--gi-teal)]">
              {clause.document}
            </p>
            <h3 className="mt-0.5 text-xs font-semibold text-foreground">{clause.section}</h3>
            <p
              className="mt-3 text-sm leading-6 text-foreground"
              style={{ fontFamily: 'var(--font-eb-garamond), Georgia, serif' }}
            >
              {clause.parts.map((part, index) => <ClausePart key={`${clause.id}-${index}`} part={part} />)}
            </p>
            {clause.annotation ? (
              <p className="mt-3 border-t border-border pt-2 text-micro leading-4 text-[var(--gi-amber)]">
                {clause.annotation}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>,
    mount,
  )
}
