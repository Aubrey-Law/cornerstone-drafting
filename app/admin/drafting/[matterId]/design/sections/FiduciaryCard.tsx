'use client'

import { useState } from 'react'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'
import type { DesignSheet, MatterContact } from '@/types/database'
import {
  getFiduciaryContactDetails,
  getFiduciaryContactDetailsMap,
  removeFiduciaryContactDetails,
  setFiduciaryContactDetails,
  type FiduciaryContactDetails,
  type FiduciaryContactGender,
  type FiduciaryContactType,
  type FiduciaryRelationshipTo,
} from '@/lib/designSheet/fiduciaryContactDetails'
import { contactFullName } from './ContactPicker'

interface FiduciaryCardProps {
  contact: MatterContact
  details: FiduciaryContactDetails
  clientName: string
  spouseName?: string | null
  onEdit: (contact: MatterContact, details: FiduciaryContactDetails) => Promise<void>
  onRemove: () => void
}

function displayAddress(contact: MatterContact): string {
  return contact.address?.trim() || '—'
}

function displayPhone(contact: MatterContact): string {
  return formatPhoneDisplay(contact.phone) || '—'
}

function displayEmail(contact: MatterContact): string {
  return contact.email?.trim() || '—'
}

export function FiduciaryCard({ contact, details, clientName, spouseName, onEdit, onRemove }: FiduciaryCardProps) {
  const [showEdit, setShowEdit] = useState(false)

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">{contactFullName(contact)}</h4>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Edit fiduciary"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive"
              aria-label="Remove fiduciary"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <dl className="space-y-1.5 text-xs">
          <div>
            <dt className="font-medium text-muted-foreground">Address</dt>
            <dd className="whitespace-pre-line text-foreground">{displayAddress(contact)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Phone</dt>
            <dd className="text-foreground">{displayPhone(contact)}</dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">Email</dt>
            <dd className="break-all text-foreground">{displayEmail(contact)}</dd>
          </div>
        </dl>
      </div>

      <FiduciaryEditDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        contact={contact}
        details={details}
        clientName={clientName}
        spouseName={spouseName}
        onSave={async (nextContact, nextDetails) => {
          await onEdit(nextContact, nextDetails)
          setShowEdit(false)
        }}
      />
    </>
  )
}

interface FiduciaryEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: MatterContact | null
  details: FiduciaryContactDetails
  clientName: string
  spouseName?: string | null
  isNew?: boolean
  onSave: (contact: MatterContact, details: FiduciaryContactDetails) => Promise<void>
}

type FiduciaryForm = {
  fiduciary_type: FiduciaryContactType
  first_name: string
  middle_name: string
  last_name: string
  gender: FiduciaryContactGender | ''
  date_of_birth: string
  phone: string
  email: string
  address: string
  relationship_to: FiduciaryRelationshipTo | ''
  relationship: string
}

function emptyForm(): FiduciaryForm {
  return {
    fiduciary_type: 'individual',
    first_name: '',
    middle_name: '',
    last_name: '',
    gender: '',
    date_of_birth: '',
    phone: '',
    email: '',
    address: '',
    relationship_to: 'client',
    relationship: '',
  }
}

function toForm(contact: MatterContact | null, details: FiduciaryContactDetails): FiduciaryForm {
  if (!contact) return emptyForm()
  return {
    fiduciary_type: details.fiduciary_type ?? 'individual',
    first_name: contact.first_name ?? '',
    middle_name: contact.middle_name ?? '',
    last_name: contact.last_name ?? '',
    gender: details.gender ?? '',
    date_of_birth: contact.date_of_birth ?? '',
    phone: formatPhoneDisplay(contact.phone) || '',
    email: contact.email ?? '',
    address: contact.address ?? '',
    relationship_to: details.relationship_to ?? 'client',
    relationship: contact.relationship ?? '',
  }
}

function toContactPayload(form: FiduciaryForm): Omit<MatterContact, 'id'> {
  return {
    first_name: form.first_name.trim(),
    middle_name: form.middle_name.trim() || null,
    last_name: form.last_name.trim(),
    phone: formatPhoneForStorage(form.phone) || null,
    email: form.email.trim() || null,
    address: form.address.trim() || null,
    relationship: form.relationship.trim() || null,
    date_of_birth: form.date_of_birth.trim() || null,
  }
}

function toDetailsPayload(form: FiduciaryForm): FiduciaryContactDetails {
  return {
    fiduciary_type: form.fiduciary_type,
    gender: form.gender || null,
    relationship_to: form.relationship_to || null,
  }
}

export function FiduciaryEditDialog({
  open,
  onOpenChange,
  contact,
  details,
  clientName,
  spouseName,
  isNew = false,
  onSave,
}: FiduciaryEditDialogProps) {
  const [form, setForm] = useState<FiduciaryForm>(() => toForm(contact, details))
  const [saving, setSaving] = useState(false)

  const relationshipOwnerLabel = form.relationship_to === 'spouse' && spouseName
    ? `${spouseName}'s`
    : `${clientName}'s`

  const handleOpenChange = (next: boolean) => {
    if (next) setForm(toForm(contact, details))
    onOpenChange(next)
  }

  const handleSave = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) return
    setSaving(true)
    try {
      await onSave(
        { id: contact?.id ?? '', ...toContactPayload(form) },
        toDetailsPayload(form),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save fiduciary')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add Fiduciary' : 'Edit Fiduciary'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Fiduciary Type</Label>
            <Select
              value={form.fiduciary_type}
              onValueChange={value => setForm(f => ({ ...f, fiduciary_type: value as FiduciaryContactType }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="entity">Entity</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Fiduciary&apos;s Name</Label>
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="First" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
              <Input placeholder="Middle" value={form.middle_name} onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))} />
              <Input placeholder="Last" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Gender (Optional)</Label>
              <Select
                value={form.gender || undefined}
                onValueChange={value => setForm(f => ({ ...f, gender: value as FiduciaryContactGender }))}
              >
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date of Birth (Optional)</Label>
              <Input type="date" value={form.date_of_birth} onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Fiduciary&apos;s Phone Number</Label>
            <Input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Fiduciary&apos;s Email Address</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Fiduciary&apos;s Address</Label>
            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Relationship to Client</Label>
            <Select
              value={form.relationship_to || undefined}
              onValueChange={value => setForm(f => ({ ...f, relationship_to: value as FiduciaryRelationshipTo }))}
            >
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client">{clientName}&apos;s</SelectItem>
                {spouseName ? <SelectItem value="spouse">{spouseName}&apos;s</SelectItem> : null}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Relationship Label</Label>
            <Input
              value={form.relationship}
              onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))}
              placeholder="Brother"
            />
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Relationship should be entered in relation to {relationshipOwnerLabel.replace(/'s$/, '')}. Ex: &quot;Brother&quot; or &quot;Friend&quot;
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.first_name.trim() || !form.last_name.trim()}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {saving ? 'Saving...' : isNew ? 'Add Fiduciary' : 'Update Fiduciary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface FiduciaryCardGridProps {
  sheet: DesignSheet
  contacts: MatterContact[]
  poolContactIds: string[]
  clientName: string
  spouseName?: string | null
  onChange: (field: keyof DesignSheet, value: DesignSheet[keyof DesignSheet]) => void
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onPoolChange: (ids: string[]) => void
}

export function FiduciaryCardGrid({
  sheet,
  contacts,
  poolContactIds,
  clientName,
  spouseName,
  onChange,
  onAddContact,
  onUpdateContact,
  onPoolChange,
}: FiduciaryCardGridProps) {
  const [showAdd, setShowAdd] = useState(false)
  const detailsMap = getFiduciaryContactDetailsMap(sheet)

  const resolveContact = (id: string): MatterContact | null =>
    contacts.find(contact => contact.id === id) ?? null

  const handleEdit = async (contact: MatterContact, details: FiduciaryContactDetails) => {
    if (!onUpdateContact || !contact.id) throw new Error('Contact updates are not available')
    const saved = await onUpdateContact(contact.id, contact)
    onChange('decisions', setFiduciaryContactDetails(sheet, saved.id, details))
  }

  const handleAdd = async (contact: MatterContact, details: FiduciaryContactDetails) => {
    const { id: _id, ...data } = contact
    const saved = contact.id ? contact : await onAddContact(data)
    onChange('decisions', setFiduciaryContactDetails(sheet, saved.id, details))
    onPoolChange([...poolContactIds, saved.id])
    setShowAdd(false)
  }

  const handleRemove = (contactId: string) => {
    onPoolChange(poolContactIds.filter(id => id !== contactId))
    onChange('decisions', removeFiduciaryContactDetails(sheet, contactId))
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {poolContactIds.map(contactId => {
          const contact = resolveContact(contactId)
          if (!contact) return null
          return (
            <FiduciaryCard
              key={contactId}
              contact={contact}
              details={detailsMap[contactId] ?? getFiduciaryContactDetails(sheet, contactId)}
              clientName={clientName}
              spouseName={spouseName}
              onEdit={handleEdit}
              onRemove={() => handleRemove(contactId)}
            />
          )
        })}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="mt-4 gap-1.5 text-xs"
        onClick={() => setShowAdd(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        Add Fiduciary
      </Button>

      <FiduciaryEditDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        contact={null}
        details={{}}
        clientName={clientName}
        spouseName={spouseName}
        isNew
        onSave={handleAdd}
      />
    </div>
  )
}
