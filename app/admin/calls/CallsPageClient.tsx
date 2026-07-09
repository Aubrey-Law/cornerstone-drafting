'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { CallRow, type CallRowData } from '@/components/calls/CallRow'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { AssignCallDialog } from './AssignCallDialog'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsInvalidation'

export interface AdminCallRow extends CallRowData {
  matter_id: string | null
}

interface Props {
  initialCalls: AdminCallRow[]
  filter: string
}

export function CallsPageClient({ initialCalls, filter }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [assigning, setAssigning] = useState<AdminCallRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminCallRow | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  function setFilter(next: string) {
    const sp = new URLSearchParams(params)
    sp.set('filter', next)
    router.push(`/admin/calls?${sp.toString()}`)
  }

  async function deleteCall(call: AdminCallRow) {
    setDeleteTarget(null)
    setDeletingId(call.id)
    const res = await fetch(`/api/admin/calls/${call.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setDeletingId(null)
    if (!res.ok) {
      toast.error(json.error ?? 'Failed to delete call')
      return
    }
    toast.success('Call deleted')
    invalidateSidebarCountsClient()
    router.refresh()
  }

  const emptyLabel = useMemo(
    () => (filter === 'unassigned' ? 'No unassigned calls.' : 'No calls logged yet.'),
    [filter],
  )

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant={filter === 'unassigned' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('unassigned')}
        >
          Unassigned
        </Button>
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All
        </Button>
      </div>

      {initialCalls.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {initialCalls.map((call) => (
            <div key={call.id} className="flex items-start gap-2 pr-2">
              <div className="min-w-0 flex-1">
                <CallRow call={call} />
              </div>
              <div className="flex shrink-0 flex-col gap-1 py-2">
                {!call.matter_id && (
                  <Button size="sm" variant="outline" onClick={() => setAssigning(call)}>
                    Assign
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deletingId === call.id}
                  onClick={() => setDeleteTarget(call)}
                  aria-label="Delete call"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {assigning && (
        <AssignCallDialog
          call={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setAssigning(null)
            router.refresh()
          }}
        />
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the call log entry. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void deleteCall(deleteTarget)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
