'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsInvalidation'
import type { AdminCallRow } from './CallsPageClient'

interface Option {
  id: string
  label: string
}

interface Props {
  call: AdminCallRow
  onClose: () => void
  onAssigned: () => void
}

export function AssignCallDialog({ call, onClose, onAssigned }: Props) {
  const token = useAccessToken()
  const [query, setQuery] = useState('')
  const [matters, setMatters] = useState<Option[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!query.trim() || !token) {
      setMatters([])
      return
    }
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/admin/calls/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const json = await res.json()
      setMatters(json.matters ?? [])
    }, 200)
    return () => clearTimeout(handle)
  }, [query, token])

  async function assign(matterId: string) {
    if (!token) return
    setSubmitting(true)
    const res = await fetch(`/api/admin/calls/${call.id}/assign`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ matterId }),
    })
    setSubmitting(false)
    if (!res.ok) {
      toast.error('Failed to assign call')
      return
    }
    toast.success('Call assigned')
    invalidateSidebarCountsClient()
    onAssigned()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign call from {call.participant_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="assign-call-search">Search matters</Label>
            <Input
              id="assign-call-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, email, phone…"
              autoFocus
            />
          </div>
          {matters.length > 0 ? (
            <div>
              <div className="text-xs font-semibold text-muted-foreground">Matters</div>
              {matters.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={submitting}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-accent"
                  onClick={() => void assign(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
          {matters.length === 0 && query.trim() ? (
            <div className="text-sm text-muted-foreground">No matches.</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
