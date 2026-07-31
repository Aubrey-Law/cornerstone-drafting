'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { formatPhoneInput } from '@/lib/phone'

export interface RelatedPersonOption {
  /** client_intake id */
  id: string
  name: string
}

interface AddContactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  relatedOptions: RelatedPersonOption[]
  onCreated: () => void
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  relationshipLabel: '',
  relatedId: 'none',
}

export function AddContactDialog({ open, onOpenChange, relatedOptions, onCreated }: AddContactDialogProps) {
  const token = useAccessToken()
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const update = (values: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...values }))

  function close(next: boolean) {
    if (!next) setForm(EMPTY_FORM)
    onOpenChange(next)
  }

  async function save() {
    if (!token) return
    setSaving(true)
    try {
      await apiRequest('/api/admin/contacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.firstName,
          last_name: form.lastName,
          email: form.email,
          phone: form.phone,
          relationship_label: form.relationshipLabel,
          client_intake_id: form.relatedId === 'none' ? null : form.relatedId,
        }),
      }, 'Could not add contact')
      toast.success('Contact added')
      close(false)
      onCreated()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not add contact')
    } finally {
      setSaving(false)
    }
  }

  const ready = Boolean(form.firstName.trim() || form.lastName.trim())

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>
            Add a person to the firm contact book — a referrer, professional, or someone connected to a client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="contact-first-name">First name</Label>
              <Input
                id="contact-first-name"
                value={form.firstName}
                onChange={e => update({ firstName: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-last-name">Last name</Label>
              <Input
                id="contact-last-name"
                value={form.lastName}
                onChange={e => update({ lastName: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={form.email}
              onChange={e => update({ email: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              type="tel"
              value={form.phone}
              onChange={e => update({ phone: formatPhoneInput(e.target.value) })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contact-relationship">Relationship / role</Label>
            <Input
              id="contact-relationship"
              placeholder="e.g. Referring CPA, Financial advisor"
              value={form.relationshipLabel}
              onChange={e => update({ relationshipLabel: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Related to</Label>
            <Select value={form.relatedId} onValueChange={relatedId => update({ relatedId })}>
              <SelectTrigger aria-label="Related person">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No one — standalone contact</SelectItem>
                {relatedOptions.map(option => (
                  <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !ready}>
            {saving ? 'Adding…' : 'Add contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
