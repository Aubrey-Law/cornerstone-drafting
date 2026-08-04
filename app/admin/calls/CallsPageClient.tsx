'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { CallRow, type CallRowData } from '@/components/calls/CallRow'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'

export interface AdminCallRow extends CallRowData {
  matter_id: string | null
  lead_id: string | null
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // A new filter or a fresh server page means the old ids may not be on screen.
  useEffect(() => {
    setSelected(new Set())
  }, [filter, initialCalls])

  const allSelected = initialCalls.length > 0 && selected.size === initialCalls.length

  function toggleCall(id: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(initialCalls.map(call => call.id)) : new Set())
  }

  async function bulkDelete() {
    // Ordered by the list, not by click order, so the request reads predictably.
    const ids = initialCalls.map(call => call.id).filter(id => selected.has(id))
    setBulkOpen(false)
    setBulkDeleting(true)
    const res = await fetch('/api/admin/calls/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const json = await res.json().catch(() => ({}))
    setBulkDeleting(false)
    if (!res.ok) {
      toast.error(json.error ?? 'Failed to delete calls')
      return
    }
    toast.success(`${ids.length} call${ids.length === 1 ? '' : 's'} deleted`)
    setSelected(new Set())
    invalidateSidebarCountsClient()
    router.refresh()
  }

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
    () => (filter === 'unassigned' ? 'Every call is linked to a lead or matter.' : 'No calls logged yet.'),
    [filter],
  )

  return (
    <>
      <div className="flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All calls
        </Button>
        <Button
          variant={filter === 'unassigned' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('unassigned')}
        >
          Not linked
        </Button>
      </div>

      {initialCalls.length > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
          <Checkbox
            aria-label="Select all calls"
            checked={allSelected ? true : selected.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => toggleAll(checked === true)}
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : 'Select calls to delete in bulk'}
          </span>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={bulkDeleting}
                onClick={() => setBulkOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>
      )}

      {initialCalls.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {initialCalls.map((call) => (
            <div key={call.id} className="flex items-start gap-2 pr-2">
              <Checkbox
                className="ml-3 mt-3"
                aria-label={`Select call from ${call.participant_number}`}
                checked={selected.has(call.id)}
                onCheckedChange={(checked) => toggleCall(call.id, checked === true)}
              />
              <div className="min-w-0 flex-1">
                <CallRow call={call} />
              </div>
              <div className="flex shrink-0 flex-col gap-1 py-2">
                {call.matter_id ? (
                  <Link className="text-center text-xs text-primary underline" href={`/admin/matters/${call.matter_id}`}>
                    View matter
                  </Link>
                ) : call.lead_id ? (
                  <Link className="text-center text-xs text-primary underline" href={`/admin/leads/${call.lead_id}`}>
                    View lead
                  </Link>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => setAssigning(call)}>
                  {call.matter_id || call.lead_id ? 'Change link' : 'Link call'}
                </Button>
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

      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} call{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected call log entries. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void bulkDelete()}>
              Delete {selected.size} call{selected.size === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
