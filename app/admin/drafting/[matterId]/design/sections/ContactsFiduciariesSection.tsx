'use client'

import { useMemo, useState } from 'react'
import {
  CircleHelp,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  User,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import type { DesignSheet, MatterContact } from '@/types/database'
import { DesignSectionContent, SectionBlock, type SectionProps } from './shared'
import { contactFullName } from './ContactPicker'
import { AddPersonDialog, type PersonFormValues } from './AddPersonDialog'
import {
  BENEFICIARY_TYPE_LABELS,
  FIDUCIARY_DOCUMENT_INCLUSION_OPTIONS,
  FIDUCIARY_TYPE_LABELS,
  getContactProfiles,
  getFiduciaryDocumentInclusions,
  removeContactProfile,
  setContactProfile,
  setFiduciaryDocumentInclusion,
  type BeneficiaryEntityType,
  type ContactProfile,
  type FiduciaryEntityType,
} from '@/lib/designSheet/fiduciaryDocumentInclusions'

interface Props extends SectionProps {
  contacts: MatterContact[]
  matterId: string
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onRemoveContact?: (id: string) => void
}

function HelpHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex text-muted-foreground hover:text-foreground">
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">{text}</TooltipContent>
    </Tooltip>
  )
}

function formatAddress(contact: MatterContact): string | null {
  return contact.address?.trim() || null
}

function relationshipLine(contact: MatterContact, profile: ContactProfile | undefined): string | null {
  if (profile?.relationship_detail?.trim()) {
    const base = profile.relationship_to === 'client'
      ? 'client'
      : profile.relationship_to === 'spouse'
        ? 'spouse'
        : profile.relationship_to === 'joint'
          ? 'client and spouse'
          : null
    if (base) return `(${profile.relationship_detail.trim()} — ${base})`
    return `(${profile.relationship_detail.trim()})`
  }
  if (contact.relationship?.trim()) return `(${contact.relationship.trim()})`
  return null
}

function PersonCard({
  contact,
  profile,
  typeLabel,
  onEdit,
  onDelete,
  showAlsoAsBeneficiary,
}: {
  contact: MatterContact
  profile?: ContactProfile
  typeLabel?: string
  onEdit: () => void
  onDelete?: () => void
  showAlsoAsBeneficiary?: boolean
}) {
  const name = contactFullName(contact)
  const rel = relationshipLine(contact, profile)
  const address = formatAddress(contact)
  const phone = formatPhoneDisplay(contact.phone) || null
  const email = contact.email?.trim() || null

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <User className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-primary">{name}</p>
              {showAlsoAsBeneficiary && (
                <span title="Also a beneficiary" className="text-primary">
                  <UserPlus className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            {rel && <p className="text-xs text-muted-foreground">{rel}</p>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <dl className="space-y-1 text-xs">
        {typeLabel && (
          <div className="flex gap-2">
            <dt className="font-semibold text-foreground">Type:</dt>
            <dd className="text-muted-foreground">{typeLabel}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-semibold text-foreground">Address:</dt>
          <dd className={cn(!address && 'italic text-muted-foreground')}>
            {address || 'No Address provided'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold text-foreground">Phone:</dt>
          <dd className={cn(!phone && 'italic text-muted-foreground')}>
            {phone || 'No Phone provided'}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold text-foreground">Email:</dt>
          <dd className={cn(!email && 'italic text-muted-foreground')}>
            {email || 'No Email provided'}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function ContactsFiduciariesSection({
  sheet,
  onChange,
  contacts,
  matterId,
  onAddContact,
  onUpdateContact,
  onRemoveContact,
}: Props) {
  const [addFiduciaryOpen, setAddFiduciaryOpen] = useState(false)
  const [addBeneficiaryOpen, setAddBeneficiaryOpen] = useState(false)
  const [editing, setEditing] = useState<{
    contact: MatterContact
    mode: 'fiduciary' | 'beneficiary'
  } | null>(null)

  const clientName = (sheet.client_name ?? '').trim()
  const spouseName = (sheet.spouse_name ?? '').trim()
  const inclusions = getFiduciaryDocumentInclusions(sheet)
  const profiles = getContactProfiles(sheet)

  const fiduciaryContacts = useMemo(() => {
    return contacts.filter(c => {
      const profile = profiles[c.id]
      if (profile?.is_beneficiary && !profile?.is_fiduciary) return false
      if (profile?.is_fiduciary) return true
      return profile?.is_fiduciary !== false
    })
  }, [contacts, profiles])

  const beneficiaryContacts = useMemo(() => {
    return contacts.filter(c => profiles[c.id]?.is_beneficiary)
  }, [contacts, profiles])

  const handleDeleteContact = async (contact: MatterContact) => {
    const label = contactFullName(contact)
    if (!window.confirm(`Remove ${label} from this matter?`)) return
    try {
      const res = await fetch(
        `/api/admin/matters/${matterId}/design-sheet/contacts?contactId=${encodeURIComponent(contact.id)}`,
        { method: 'DELETE' },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to remove contact')
      onChange('decisions', removeContactProfile(sheet, contact.id))
      onRemoveContact?.(contact.id)
      toast.success('Contact removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove contact')
    }
  }

  const savePerson = async (
    values: PersonFormValues,
    mode: 'fiduciary' | 'beneficiary',
    existingId?: string,
  ) => {
    const payload: Omit<MatterContact, 'id'> = {
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      middle_name: values.middle_name?.trim() || undefined,
      preferred_pronoun: values.gender?.trim() || undefined,
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
      address: values.address?.trim() || undefined,
      relationship: values.relationship_detail?.trim() || values.relationship_to || undefined,
    }

    let contact: MatterContact
    if (existingId && onUpdateContact) {
      contact = await onUpdateContact(existingId, payload)
    } else {
      contact = await onAddContact(payload)
    }

    const profilePatch: Partial<ContactProfile> = {
      is_fiduciary: mode === 'fiduciary' ? true : Boolean(values.also_fiduciary),
      is_beneficiary: mode === 'beneficiary' ? true : Boolean(values.also_beneficiary),
      fiduciary_type: values.fiduciary_type,
      beneficiary_type: values.beneficiary_type,
      relationship_to: values.relationship_to,
      relationship_detail: values.relationship_detail,
      date_of_birth: values.date_of_birth || null,
    }
    onChange('decisions', setContactProfile(sheet, contact.id, profilePatch))
  }

  return (
    <DesignSectionContent>
      <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800/40 dark:bg-blue-950/20">
        <p className="text-[12px] leading-relaxed text-blue-800 dark:text-blue-200">
          Add all potential decisionmakers and fiduciaries below. Adult children and spouses are added automatically.
        </p>
      </div>

      <SectionBlock title="All Fiduciaries and Decisionmakers">
        <div className="space-y-4">
          {FIDUCIARY_DOCUMENT_INCLUSION_OPTIONS.map(opt => (
            <label key={opt.key} className="flex items-start gap-3">
              <Checkbox
                checked={inclusions[opt.key]}
                onCheckedChange={checked =>
                  onChange('decisions', setFiduciaryDocumentInclusion(sheet, opt.key, checked === true))
                }
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {opt.label}
                  <HelpHint text={opt.help} />
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{opt.help}</span>
              </span>
            </label>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Fiduciaries"
        subtitle="List trustees, guardians, POA agents, executors, healthcare agents, disposition agents, etc. Specific roles are assigned on later pages."
      >
        {fiduciaryContacts.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">No fiduciaries added yet.</p>
        ) : (
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            {fiduciaryContacts.map(contact => {
              const profile = profiles[contact.id]
              const type = profile?.fiduciary_type
                ? FIDUCIARY_TYPE_LABELS[profile.fiduciary_type]
                : undefined
              return (
                <PersonCard
                  key={contact.id}
                  contact={contact}
                  profile={profile}
                  typeLabel={type}
                  showAlsoAsBeneficiary={Boolean(profile?.is_beneficiary)}
                  onEdit={() => setEditing({ contact, mode: 'fiduciary' })}
                  onDelete={() => void handleDeleteContact(contact)}
                />
              )
            })}
          </div>
        )}
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={() => setAddFiduciaryOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Fiduciary
        </Button>
      </SectionBlock>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          All Beneficiaries
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800/40 dark:bg-blue-950/20">
        <p className="text-[12px] leading-relaxed text-blue-800 dark:text-blue-200">
          Add all potential beneficiaries below. The beneficiaries you add here will be available as options when designing distributions on the following pages. Children and spouses are added automatically.
        </p>
      </div>

      <SectionBlock
        title="Beneficiaries"
        subtitle="Please list all of your client's beneficiaries below, including anyone who will receive a gift or be a beneficiary of a residual distribution. This includes individuals, groups of individuals, and charities."
      >
        {beneficiaryContacts.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">No beneficiaries added yet.</p>
        ) : (
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            {beneficiaryContacts.map(contact => {
              const profile = profiles[contact.id]
              const type = profile?.beneficiary_type
                ? BENEFICIARY_TYPE_LABELS[profile.beneficiary_type]
                : undefined
              return (
                <PersonCard
                  key={contact.id}
                  contact={contact}
                  profile={profile}
                  typeLabel={type}
                  onEdit={() => setEditing({ contact, mode: 'beneficiary' })}
                  onDelete={() => void handleDeleteContact(contact)}
                />
              )
            })}
          </div>
        )}
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={() => setAddBeneficiaryOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Beneficiary
        </Button>
      </SectionBlock>

      <AddPersonDialog
        open={addFiduciaryOpen}
        onOpenChange={setAddFiduciaryOpen}
        mode="fiduciary"
        clientName={clientName}
        spouseName={spouseName}
        title="Add Fiduciary"
        subtitle="Enter the fiduciary details below."
        onSave={values => savePerson(values, 'fiduciary')}
      />

      <AddPersonDialog
        open={addBeneficiaryOpen}
        onOpenChange={setAddBeneficiaryOpen}
        mode="beneficiary"
        clientName={clientName}
        spouseName={spouseName}
        title="Add Beneficiary"
        subtitle="Enter the beneficiary details below."
        onSave={values => savePerson(values, 'beneficiary')}
      />

      {editing && (
        <AddPersonDialog
          open
          onOpenChange={open => { if (!open) setEditing(null) }}
          mode={editing.mode}
          clientName={clientName}
          spouseName={spouseName}
          title={editing.mode === 'fiduciary' ? 'Edit Fiduciary' : 'Edit Beneficiary'}
          subtitle={editing.mode === 'fiduciary'
            ? 'Update the fiduciary details below.'
            : 'Update the beneficiary details below.'}
          initialContact={editing.contact}
          initialProfile={profiles[editing.contact.id]}
          onSave={async values => {
            await savePerson(values, editing.mode, editing.contact.id)
            setEditing(null)
          }}
        />
      )}
    </DesignSectionContent>
  )
}
