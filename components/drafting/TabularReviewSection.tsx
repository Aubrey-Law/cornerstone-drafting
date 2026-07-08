'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, RefreshCw, Table2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { ESTATE_TABULAR_PRESETS } from '@/lib/estateTabularPresets'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface TabularReviewSectionProps {
  matterId: string
  documentIds: string[]
}

interface ReviewRow {
  id: string
  title: string
  columns_config: Array<{ index: number; name: string }>
  document_ids: string[]
  updated_at: string
}

interface CellRow {
  id: string
  document_id: string
  column_index: number
  content: string | null
  status: string
}

export function TabularReviewSection({ matterId, documentIds }: TabularReviewSectionProps) {
  const token = useAccessToken()
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [cells, setCells] = useState<CellRow[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const loadReviews = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/admin/matters/${matterId}/tabular-reviews`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (body.unavailable) return
      return
    }
    setReviews(body.reviews ?? [])
  }, [token, matterId])

  const loadReview = useCallback(
    async (reviewId: string) => {
      if (!token) return
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/matters/${matterId}/tabular-reviews/${reviewId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Failed to load review')
        setActiveId(reviewId)
        setCells(body.cells ?? [])
        if (body.review) {
          setReviews(prev => {
            const others = prev.filter(r => r.id !== reviewId)
            return [body.review as ReviewRow, ...others]
          })
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not load review')
      } finally {
        setLoading(false)
      }
    },
    [token, matterId],
  )

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  const createReview = async () => {
    if (!token) return
    if (documentIds.length === 0) {
      toast.error('Generate drafts first')
      return
    }
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/tabular-reviews`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preset: 'estate_package_review',
          documentIds,
          title: ESTATE_TABULAR_PRESETS.estate_package_review.label,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not create review')
      toast.success('Tabular review created')
      await loadReviews()
      if (body.review?.id) await loadReview(body.review.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    }
  }

  const generate = async () => {
    if (!token || !activeId || generating) return
    setGenerating(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/tabular-reviews/${activeId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'generate' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Generate failed')
      setCells(body.cells ?? [])
      toast.success('Cells updated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setGenerating(false)
    }
  }

  const active = reviews.find(r => r.id === activeId)
  const columns = active?.columns_config ?? []
  const docs = active?.document_ids ?? documentIds

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">Estate multi-doc review</h3>
            <p className="text-[11px] text-muted-foreground">
              Compare drafts across estate-specific columns (fiduciaries, residuary, markers).
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => void createReview()}>
            <Plus className="h-3.5 w-3.5" /> New review
          </Button>
          {activeId ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Generate cells
            </Button>
          ) : null}
        </div>
      </div>

      {reviews.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
          {reviews.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => void loadReview(r.id)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                r.id === activeId ? 'border-foreground bg-accent' : 'border-border text-muted-foreground'
              }`}
            >
              {r.title}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !active ? (
        <div className="p-6 text-sm text-muted-foreground">
          Create a review to run estate package consistency checks across current drafts.
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="w-full min-w-[720px] border-collapse text-xs">
            <thead>
              <tr>
                <th className="border border-border bg-muted/50 px-2 py-1.5 text-left font-medium">Document</th>
                {columns.map(col => (
                  <th key={col.index} className="border border-border bg-muted/50 px-2 py-1.5 text-left font-medium">
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(docId => (
                <tr key={docId}>
                  <td className="border border-border px-2 py-1.5 font-medium">
                    <span className="font-mono text-[10px] text-muted-foreground">{docId.slice(0, 8)}…</span>
                  </td>
                  {columns.map(col => {
                    const cell = cells.find(c => c.document_id === docId && c.column_index === col.index)
                    return (
                      <td key={col.index} className="border border-border px-2 py-1.5 align-top">
                        {cell?.status === 'generating' ? (
                          <Badge variant="outline" className="text-[10px]">
                            generating
                          </Badge>
                        ) : cell?.status === 'error' ? (
                          <span className="text-destructive">Error</span>
                        ) : (
                          <span className="whitespace-pre-wrap">{cell?.content || '—'}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
