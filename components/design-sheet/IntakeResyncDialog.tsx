'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { IntakeResyncPreviewRow } from '@/lib/designSheet/seedFromIntake'

interface IntakeResyncDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  matterId: string
}

type PreviewResponse = {
  error?: string
  preview?: IntakeResyncPreviewRow[]
}

function buildSelectedRows(rows: IntakeResyncPreviewRow[]): Record<string, boolean> {
  return Object.fromEntries(rows.map(row => [row.field, row.selected && !row.blocked]))
}

export function IntakeResyncDialog({ open, onOpenChange, matterId }: IntakeResyncDialogProps) {
  const router = useRouter()
  const [previewRows, setPreviewRows] = useState<IntakeResyncPreviewRow[]>([])
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const selectedCount = useMemo(
    () => previewRows.filter(row => selectedRows[row.field]).length,
    [previewRows, selectedRows],
  )

  useEffect(() => {
    if (!open) return

    setLoading(true)
    setPreviewRows([])
    setSelectedRows({})

    fetch(`/api/admin/matters/${matterId}/design-sheet/resync-intake`)
      .then(async response => {
        const result = await response.json().catch(() => ({})) as PreviewResponse
        if (!response.ok) {
          throw new Error(result.error ?? `Preview failed (${response.status})`)
        }
        const rows = Array.isArray(result.preview) ? result.preview : []
        setPreviewRows(rows)
        setSelectedRows(buildSelectedRows(rows))
      })
      .catch(error => {
        console.error(error)
        toast.error(error instanceof Error ? error.message : 'Could not load intake differences')
      })
      .finally(() => setLoading(false))
  }, [matterId, open])

  const handleApply = useCallback(async () => {
    const fields = previewRows
      .map(row => row.field)
      .filter(field => selectedRows[field])

    if (!fields.length) {
      toast.error('Select at least one field to re-sync')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/resync-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      const result = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error ?? `Re-sync failed (${response.status})`)
      }

      toast.success(`Updated ${fields.length} design sheet field${fields.length === 1 ? '' : 's'} from intake`)
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Could not re-sync from intake')
    } finally {
      setSubmitting(false)
    }
  }, [matterId, onOpenChange, previewRows, router, selectedRows])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Re-sync from intake</DialogTitle>
          <DialogDescription>
            Choose which intake values to copy into the design sheet. Fields you have overridden on the
            design sheet are blocked unless you clear the override first.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comparing intake to design sheet…
          </div>
        ) : previewRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Intake and design sheet already match for all seedable fields.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted backdrop-blur">
                <tr className="border-b border-border">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Design sheet</th>
                  <th className="px-3 py-2 font-medium">Intake</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map(row => (
                  <tr key={row.field} className="border-b border-border/70 align-top">
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={Boolean(selectedRows[row.field])}
                        disabled={row.blocked}
                        onCheckedChange={checked => {
                          setSelectedRows(prev => ({ ...prev, [row.field]: checked === true }))
                        }}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{row.label}</div>
                      <div className="text-xs text-muted-foreground">{row.section}</div>
                      {row.blocked && (
                        <div className="mt-1 text-xs text-warning">Attorney override — clear override to re-sync</div>
                      )}
                    </td>
                    <td className={cn('px-3 py-3 text-muted-foreground', row.replacement && 'text-foreground')}>
                      {row.currentDisplay}
                    </td>
                    <td className="px-3 py-3 text-foreground">{row.proposedDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={submitting || loading || selectedCount === 0}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Apply {selectedCount > 0 ? `(${selectedCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
