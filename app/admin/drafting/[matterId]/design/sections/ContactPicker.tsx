'use client'

import { useState, useRef, useEffect, type Dispatch, type SetStateAction } from 'react'
import { Loader2, Pencil, Search, X, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface Contact {
  id: string
  first_name: string
  middle_name?: string | null
  last_name: string
  suffix?: string | null
  preferred_name?: string | null
  preferred_pronoun?: string | null
  relationship?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
}

/** Full display name, including a middle name when present. */
export function contactFullName(c: Pick<Contact, 'first_name' | 'middle_name' | 'last_name' | 'suffix'>): string {
  const suffix = c.suffix ?? null
  return [c.first_name, c.middle_name, c.last_name, suffix].filter(Boolean).join(' ')
}

const PRONOUN_OPTIONS = [
  { value: 'he/him', label: 'He/Him' },
  { value: 'she/her', label: 'She/Her' },
  { value: 'they/them', label: 'They/Them' },
  { value: 'ze/zir', label: 'Ze/Zir' },
  { value: 'other', label: 'Other' },
]

interface ContactPickerProps {
  role: string
  required?: boolean
  value: Contact | null
  onChange: (contact: Contact | null) => void
  contacts: Contact[]
  onAddContact: (data: Omit<Contact, 'id'>) => Promise<Contact>
  onUpdateContact?: (id: string, data: Omit<Contact, 'id'>) => Promise<Contact>
}

type ContactForm = Omit<Contact, 'id'>

function emptyContactForm(): ContactForm {
  return {
    first_name: '',
    middle_name: '',
    last_name: '',
    suffix: '',
    preferred_name: '',
    preferred_pronoun: '',
    relationship: '',
    phone: '',
    email: '',
    address: '',
  }
}

function contactToForm(contact: Contact | null): ContactForm {
  if (!contact) return emptyContactForm()
  return {
    first_name: contact.first_name ?? '',
    middle_name: contact.middle_name ?? '',
    last_name: contact.last_name ?? '',
    suffix: contact.suffix ?? '',
    preferred_name: contact.preferred_name ?? '',
    preferred_pronoun: contact.preferred_pronoun ?? '',
    relationship: contact.relationship ?? '',
    phone: formatPhoneDisplay(contact.phone) || '',
    email: contact.email ?? '',
    address: contact.address ?? '',
  }
}

function normalizeContactForm(form: ContactForm): Omit<Contact, 'id'> {
  return {
    first_name: form.first_name.trim(),
    middle_name: form.middle_name?.trim() || undefined,
    last_name: form.last_name.trim(),
    suffix: form.suffix?.trim() || undefined,
    preferred_name: form.preferred_name?.trim() || undefined,
    preferred_pronoun: form.preferred_pronoun?.trim() || undefined,
    relationship: form.relationship?.trim() || undefined,
    phone: formatPhoneForStorage(form.phone) || undefined,
    email: form.email?.trim() || undefined,
    address: form.address?.trim() || undefined,
  }
}

function isRealContact(contact: Contact | null): contact is Contact {
  return Boolean(contact?.id && !contact.id.startsWith('__'))
}

export default function ContactPicker({ role, required, value, onChange, contacts, onAddContact, onUpdateContact }: ContactPickerProps) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [addForm, setAddForm] = useState<ContactForm>(() => emptyContactForm())
  const [editForm, setEditForm] = useState<ContactForm>(() => emptyContactForm())
  const [adding, setAdding] = useState(false)
  const [updating, setUpdating] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = contacts.filter((c, index, arr) => {
    if (!c?.id || arr.findIndex(x => x.id === c.id) !== index) return false
    const q = query.toLowerCase()
    return contactFullName(c).toLowerCase().includes(q)
  }).slice(0, 5)

  const handleAdd = async () => {
    if (!addForm.first_name.trim() || !addForm.last_name.trim()) return
    setAdding(true)
    try {
      const contact = await onAddContact(normalizeContactForm(addForm))
      onChange(contact)
      setShowAddModal(false)
      setShowDropdown(false)
      setAddForm(emptyContactForm())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add contact')
    } finally {
      setAdding(false)
    }
  }

  const handleEdit = async () => {
    if (!isRealContact(value) || !onUpdateContact || !editForm.first_name.trim() || !editForm.last_name.trim()) return
    setUpdating(true)
    try {
      const contact = await onUpdateContact(value.id, normalizeContactForm(editForm))
      onChange(contact)
      setShowEditModal(false)
      toast.success('Contact updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update contact')
    } finally {
      setUpdating(false)
    }
  }

  const getInitials = (c: Contact) => `${c.first_name?.[0] ?? ''}${c.last_name?.[0] ?? ''}`.toUpperCase()

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[12px] font-medium text-foreground">{role}</span>
        {required && <span className="text-[10px] text-destructive">*</span>}
      </div>

      {value ? (
        /* Selected contact chip */
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
            {getInitials(value)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground">{contactFullName(value)}</div>
            {(value.relationship || value.preferred_name || value.preferred_pronoun) && (
              <div className="text-[11px] text-muted-foreground">
                {[value.relationship, value.preferred_name ? `Goes by ${value.preferred_name}` : null, value.preferred_pronoun].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          {isRealContact(value) && onUpdateContact && (
            <button
              type="button"
              onClick={() => {
                setEditForm(contactToForm(value))
                setShowEditModal(true)
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Edit contact"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        /* Search input + dropdown */
        <div ref={wrapperRef} className="relative">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setShowDropdown(true) }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search contacts…"
              className={cn(
                'w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground',
                'outline-none transition-shadow focus:border-accent focus:shadow-[0_0_0_3px_oklch(0.42_0.075_195_/_0.1)]'
              )}
            />
          </div>

          {showDropdown && (
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              {filtered.length > 0 ? (
                filtered.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onChange(c); setQuery(''); setShowDropdown(false) }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                      {getInitials(c)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-foreground">{contactFullName(c)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {[c.relationship, formatPhoneDisplay(c.phone)].filter(Boolean).join(' · ') || ''}
                      </div>
                    </div>
                  </button>
                ))
              ) : query.trim() ? (
                <div className="px-3 py-3 text-center text-[12px] text-muted-foreground">No matches</div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(true)
                  setShowDropdown(false)
                  if (query.trim()) {
                    const parts = query.trim().split(/\s+/)
                    setAddForm(f => parts.length >= 3
                      ? { ...f, first_name: parts[0], middle_name: parts.slice(1, -1).join(' '), last_name: parts.at(-1) ?? '' }
                      : { ...f, first_name: parts[0] ?? '', middle_name: '', last_name: parts.slice(1).join(' ') })
                  }
                }}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10"
              >
                <Plus className="h-3.5 w-3.5" />
                {query.trim() ? `Add "${query.trim()}" as new contact` : 'Add new contact'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add Contact Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
          <ContactFormFields form={addForm} setForm={setAddForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={adding || !addForm.first_name.trim() || !addForm.last_name.trim()}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {adding ? 'Adding…' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          <ContactFormFields form={editForm} setForm={setEditForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)} disabled={updating}>Cancel</Button>
            <Button
              onClick={handleEdit}
              disabled={updating || !editForm.first_name.trim() || !editForm.last_name.trim()}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {updating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {updating ? 'Saving...' : 'Save Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ContactFormFields({
  form,
  setForm,
}: {
  form: ContactForm
  setForm: Dispatch<SetStateAction<ContactForm>>
}) {
  return (
    <div className="space-y-3 py-2">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1"><Label className="text-xs">First name *</Label><Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} /></div>
        <div className="space-y-1"><Label className="text-xs">Middle name</Label><Input value={form.middle_name ?? ''} onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))} /></div>
        <div className="space-y-1"><Label className="text-xs">Last name *</Label><Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1"><Label className="text-xs">Suffix</Label><Input value={form.suffix ?? ''} onChange={e => setForm(f => ({ ...f, suffix: e.target.value }))} /></div>
        <div className="space-y-1"><Label className="text-xs">Preferred name</Label><Input value={form.preferred_name ?? ''} onChange={e => setForm(f => ({ ...f, preferred_name: e.target.value }))} /></div>
        <div className="space-y-1">
          <Label className="text-xs">Pronouns</Label>
          <Select value={form.preferred_pronoun || undefined} onValueChange={value => setForm(f => ({ ...f, preferred_pronoun: value }))}>
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {PRONOUN_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1"><Label className="text-xs">Relationship</Label><Input value={form.relationship ?? ''} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} placeholder="e.g. Brother, Friend" /></div>
      <div className="space-y-1"><Label className="text-xs">Phone</Label><Input type="tel" value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
      <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
      <div className="space-y-1"><Label className="text-xs">Address <span className="text-muted-foreground">(if HCP agent)</span></Label><Input value={form.address ?? ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
    </div>
  )
}
