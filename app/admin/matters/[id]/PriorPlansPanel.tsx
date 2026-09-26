'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { filePriorPlan, listPriorPlans } from '@/lib/documents'
import type { PriorPlan } from '@/lib/documents/priorPlans'

/**
 * Prior plans linked to this matter from the review workbench that are not yet
 * in its documents. Filing one copies it here unshared, so another firm's plan
 * reaches the client portal only if an attorney then shares it.
 *
 * Renders nothing when there is nothing to file — including when the list
 * cannot be loaded, since the documents tab must not break over it.
 */
export function PriorPlansPanel({
  matterId,
  onFiled,
}: {
  matterId: string
  onFiled: () => void | Promise<void>
}) {
  const [plans, setPlans] = useState<PriorPlan[]>([])
  const [filing, setFiling] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    listPriorPlans(matterId)
      .then(result => { if (current) setPlans(result) })
      .catch(() => { if (current) setPlans([]) })
    return () => { current = false }
  }, [matterId])

  const file = useCallback(async (plan: PriorPlan) => {
    setFiling(plan.id)
    try {
      const document = await filePriorPlan(matterId, plan.id)
      setPlans(previous => previous.map(p => (p.id === plan.id ? { ...p, filedDocumentId: document.id } : p)))
      toast.success(`Added ${document.name} to the documents, not shared with the client`)
      await onFiled()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add it to the documents')
    } finally {
      setFiling(null)
    }
  }, [matterId, onFiled])

  const unfiled = plans.filter(plan => !plan.filedDocumentId)
  if (unfiled.length === 0) return null

  return (
    <div className="border-b border-border px-4 py-3 text-sm" data-testid="prior-plans-panel">
      <p className="font-medium">Prior plans reviewed in the workbench</p>
      <p className="text-xs text-muted-foreground">
        Linked to this matter but not in its documents. Adding one files a copy here, not shared with the
        client until you share it.
      </p>
      <ul className="mt-2 space-y-1.5">
        {unfiled.map(plan => (
          <li key={plan.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{plan.label}</span>
              <span className="truncate text-xs text-muted-foreground">{plan.filename}</span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={filing !== null}
              onClick={() => void file(plan)}
            >
              {filing === plan.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add to documents
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
