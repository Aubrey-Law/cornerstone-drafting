'use client'

import { useEffect, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { extractPlanStructure } from '@/lib/designSheet/planStructureClone'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import type { DesignSheet } from '@/types/database'

interface CloneSource {
  matter_id: string
  client_name: string | null
  matter_name: string | null
  plan_type: string | null
  updated_at: string
}

interface ClonePlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The matter being designed — excluded from the source list. */
  matterId: string
  /** Called with the structural patch to apply to the current sheet. */
  onApply: (patch: Partial<DesignSheet>) => void
}

export function ClonePlanDialog({ open, onOpenChange, matterId, onApply }: ClonePlanDialogProps) {
  const [sources, setSources] = useState<CloneSource[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSources(null)
    setLoadError(null)
    fetch(`/api/admin/design-sheets/sources?exclude=${encodeURIComponent(matterId)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({})) as { sources?: CloneSource[]; error?: string }
        if (cancelled) return
        if (!response.ok) {
          setLoadError(data.error ?? 'Could not load matters.')
          return
        }
        setSources(data.sources ?? [])
      })
      .catch(() => {
        if (!cancelled) setLoadError('Network error. Please try again.')
      })
    return () => {
      cancelled = true
    }
  }, [open, matterId])

  const handlePick = async (source: CloneSource) => {
    if (applyingId) return
    setApplyingId(source.matter_id)
    try {
      const response = await fetch(`/api/admin/matters/${source.matter_id}/design-sheet`)
      const data = await response.json().catch(() => ({})) as { sheet?: DesignSheet | null; error?: string }
      if (!response.ok || !data.sheet) {
        toast.error(data.error ?? 'Could not load that design sheet.')
        return
      }
      const patch = extractPlanStructure(data.sheet)
      const fieldCount = Object.keys(patch).length
      if (fieldCount === 0) {
        toast.error('That design sheet has no plan structure to copy yet.')
        return
      }
      onApply(patch)
      onOpenChange(false)
      toast.success(`Copied plan structure from ${source.client_name ?? source.matter_name ?? 'matter'}`, {
        description: 'Structural choices only — people, assets, and notes stay from this matter. Review, then save.',
      })
    } catch {
      toast.error('Network error. Please try again.')
    } finally {
      setApplyingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy plan structure from another matter</DialogTitle>
          <DialogDescription>
            Copies structural choices (documents included, distribution scheme, provisions).
            Names, fiduciaries, children, assets, and notes are never copied.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : sources === null ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading matters…
          </div>
        ) : sources.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No other matters with a design sheet yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {sources.map(source => (
              <li key={source.matter_id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  disabled={applyingId !== null}
                  onClick={() => void handlePick(source)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {source.client_name ?? source.matter_name ?? 'Unnamed matter'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {source.plan_type ? designPlanTypeLabel(source.plan_type) : 'Plan not set'} · updated{' '}
                      {new Date(source.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </span>
                  {applyingId === source.matter_id
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    : <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
