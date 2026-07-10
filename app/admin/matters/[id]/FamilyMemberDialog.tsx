'use client'

import { useEffect, useState } from 'react'
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
import { formatPhoneDisplay } from '@/lib/phone'
import { PRONOUN_OPTIONS } from '@/lib/sharedFields/options'

export type FamilyMemberRole = 'client' | 'spouse' | 'child'

export interface ClientFormValues {
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  preferred_name: string
  preferred_pronoun: string
  date_of_birth: string
  email: string
  phone: string
  address_line1: string
  city: string
  state: string
  zip: string
}

export interface ContactFormValues {
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  preferred_name: string
  preferred_pronoun: string
  date_of_birth: string
  email: string
  phone: string
  address_line1: string
}

interface FamilyMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: FamilyMemberRole
  title: string
  subtitle: string
  initialClient?: ClientFormValues
  initialContact?: ContactFormValues
  onSaveClient?: (values: ClientFormValues) => Promise<void>
  onSaveContact?: (values: ContactFormValues) => Promise<void>
}

function emptyClientForm(): ClientFormValues {
  return {
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    preferred_name: '',
    preferred_pronoun: '',
    date_of_birth: '',
    email: '',
    phone: '',
    address_line1: '',
    city: '',
    state: '',
    zip: '',
  }
}

function emptyContactForm(): ContactFormValues {
  return {
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    preferred_name: '',
    preferred_pronoun: '',
    date_of_birth: '',
    email: '',
    phone: '',
    address_line1: '',
  }
}

export function FamilyMemberDialog({
  open,
  onOpenChange,
  role,
  title,
  subtitle,
  initialClient,
  initialContact,
  onSaveClient,
  onSaveContact,
}: FamilyMemberDialogProps) {
  const [clientForm, setClientForm] = useState<ClientFormValues>(() => emptyClientForm())
  const [contactForm, setContactForm] = useState<ContactFormValues>(() => emptyContactForm())
  const [saving, setSaving] = useState(false)
  const isEdit = role === 'client' ? Boolean(initialClient) : Boolean(initialContact)

  useEffect(() => {
    if (!open) return
    if (role === 'client') {
      setClientForm(initialClient ?? emptyClientForm())
    } else {
      setContactForm(initialContact ?? emptyContactForm())
    }
  }, [open, role, initialClient, initialContact])

  async function handleSubmit() {
    setSaving(true)
    try {
      if (role === 'client') {
        if (!clientForm.first_name.trim() && !clientForm.last_name.trim()) {
          toast.error('Name is required.')
          return
        }
        if (!onSaveClient) throw new Error('Save handler missing')
        await onSaveClient(clientForm)
      } else {
        if (!contactForm.first_name.trim() && !contactForm.last_name.trim()) {
          toast.error('Name is required.')
          return
        }
        if (!onSaveContact) throw new Error('Save handler missing')
        await onSaveContact(contactForm)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {role === 'client' ? (
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label>First name</Label>
                <Input value={clientForm.first_name} onChange={e => setClientForm(d => ({ ...d, first_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Middle</Label>
                <Input value={clientForm.middle_name} onChange={e => setClientForm(d => ({ ...d, middle_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input value={clientForm.last_name} onChange={e => setClientForm(d => ({ ...d, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Suffix</Label>
                <Input value={clientForm.suffix} onChange={e => setClientForm(d => ({ ...d, suffix: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Preferred name</Label>
                <Input value={clientForm.preferred_name} onChange={e => setClientForm(d => ({ ...d, preferred_name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Date of birth</Label>
                <Input type="date" value={clientForm.date_of_birth} onChange={e => setClientForm(d => ({ ...d, date_of_birth: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Pronouns</Label>
                <Select value={clientForm.preferred_pronoun || undefined} onValueChange={v => setClientForm(d => ({ ...d, preferred_pronoun: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pronouns" /></SelectTrigger>
                  <SelectContent>
                    {PRONOUN_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={clientForm.email} onChange={e => setClientForm(d => ({ ...d, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input type="tel" value={clientForm.phone} onChange={e => setClientForm(d => ({ ...d, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Street</Label>
              <Input value={clientForm.address_line1} onChange={e => setClientForm(d => ({ ...d, address_line1: e.target.value }))} />
            </div>
            <div className="grid grid-cols-[1fr_60px_80px] gap-2">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={clientForm.city} onChange={e => setClientForm(d => ({ ...d, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={clientForm.state} onChange={e => setClientForm(d => ({ ...d, state: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>ZIP</Label>
                <Input value={clientForm.zip} onChange={e => setClientForm(d => ({ ...d, zip: e.target.value }))} />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label>First name</Label>
                <Input value={contactForm.first_name} onChange={e => setContactForm(d => ({ ...d, first_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Middle</Label>
                <Input value={contactForm.middle_name} onChange={e => setContactForm(d => ({ ...d, middle_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Last name</Label>
                <Input value={contactForm.last_name} onChange={e => setContactForm(d => ({ ...d, last_name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label>Suffix</Label>
                <Input value={contactForm.suffix} onChange={e => setContactForm(d => ({ ...d, suffix: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Preferred name</Label>
                <Input value={contactForm.preferred_name} onChange={e => setContactForm(d => ({ ...d, preferred_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Pronouns</Label>
                <Select value={contactForm.preferred_pronoun || undefined} onValueChange={v => setContactForm(d => ({ ...d, preferred_pronoun: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pronouns" /></SelectTrigger>
                  <SelectContent>
                    {PRONOUN_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Date of birth</Label>
              <Input type="date" value={contactForm.date_of_birth} onChange={e => setContactForm(d => ({ ...d, date_of_birth: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={contactForm.email} onChange={e => setContactForm(d => ({ ...d, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input type="tel" value={contactForm.phone} onChange={e => setContactForm(d => ({ ...d, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={contactForm.address_line1} onChange={e => setContactForm(d => ({ ...d, address_line1: e.target.value }))} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : role === 'child' ? 'Add Child' : role === 'spouse' ? 'Add Spouse' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function clientRowToForm(client: {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  date_of_birth: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
}): ClientFormValues {
  return {
    first_name: client.first_name ?? '',
    middle_name: client.middle_name ?? '',
    last_name: client.last_name ?? '',
    suffix: client.suffix ?? '',
    preferred_name: client.preferred_name ?? '',
    preferred_pronoun: client.preferred_pronoun ?? '',
    date_of_birth: client.date_of_birth ?? '',
    email: client.email ?? '',
    phone: formatPhoneDisplay(client.phone),
    address_line1: client.address_line1 ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
    zip: client.zip ?? '',
  }
}

export function contactRowToForm(contact: {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix?: string | null
  preferred_name?: string | null
  preferred_pronoun?: string | null
  date_of_birth: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
}): ContactFormValues {
  return {
    first_name: contact.first_name ?? '',
    middle_name: contact.middle_name ?? '',
    last_name: contact.last_name ?? '',
    suffix: contact.suffix ?? '',
    preferred_name: contact.preferred_name ?? '',
    preferred_pronoun: contact.preferred_pronoun ?? '',
    date_of_birth: contact.date_of_birth ?? '',
    email: contact.email ?? '',
    phone: formatPhoneDisplay(contact.phone),
    address_line1: contact.address_line1 ?? '',
  }
}
