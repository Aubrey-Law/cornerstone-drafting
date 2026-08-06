'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { invalidateSidebarCountsClient } from '@/lib/sidebarCountsClient'
import type { LinkedCallRow } from './types'

interface Option {
  id: string
  label: string
}

interface SearchResults {
  matters?: Option[]
  leads?: Option[]
  contacts?: Option[]
}

interface Props {
  call: LinkedCallRow
  onClose: () => void
  onAssigned: () => void
}

export function AssignCallDialog({ call, onClose, onAssigned }: Props) {
  const token = useAccessToken()
  const [query, setQuery] = useState('')
  const [matters, setMatters] = useState<Option[]>([])
  const [leads, setLeads] = useState<Option[]>([])
  const [contacts, setContacts] = useState<Option[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!query.trim() || !token) {
      setMatters([])
      setLeads([])
      setContacts([])
      return
    }
    const handle = setTimeout(async () => {
      const res = await fetch(`/api/admin/calls/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const json = await res.json() as SearchResults
      setMatters(json.matters ?? [])
      setLeads(json.leads ?? [])
      setContacts(json.contacts ?? [])
    }, 200)
    return () => clearTimeout(handle)
  }, [query, token])

  async function assign(target: { matterId: string } | { leadId: string } | { contactId: string }) {
    if (!token) return
    setSubmitting(true)
    const res = await fetch(`/api/admin/calls/${call.id}/assign`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(target),
    })
    setSubmitting(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string }
      toast.error(json.error ?? 'Failed to link call')
      return
    }
    toast.success('Call linked')
    invalidateSidebarCountsClient()
    onAssigned()
  }

  const noResults = matters.length === 0 && leads.length === 0 && contacts.length === 0

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link call from {call.participant_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="assign-call-search">Search people, leads and matters</Label>
            <Input
              id="assign-call-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, email, phone or matter number…"
              autoFocus
            />
          </div>
          <OptionGroup
            title="Matters"
            options={matters}
            disabled={submitting}
            onSelect={(id) => void assign({ matterId: id })}
          />
          <OptionGroup
            title="Leads"
            options={leads}
            disabled={submitting}
            onSelect={(id) => void assign({ leadId: id })}
          />
          <OptionGroup
            title="Contacts"
            options={contacts}
            disabled={submitting}
            onSelect={(id) => void assign({ contactId: id })}
          />
          {noResults && query.trim() ? (
            <div className="text-sm text-muted-foreground">No matches.</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OptionGroup({
  title,
  options,
  disabled,
  onSelect,
}: {
  title: string
  options: Option[]
  disabled: boolean
  onSelect: (id: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          className="block w-full rounded px-2 py-1 text-left hover:bg-accent disabled:opacity-50"
          onClick={() => onSelect(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
