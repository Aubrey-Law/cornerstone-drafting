'use client'

import { useEffect, useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatPhoneDisplay, formatPhoneForStorage, formatPhoneInput } from '@/lib/phone'
import type { MatterContact } from '@/types/database'
import {
  BENEFICIARY_TYPE_OPTIONS,
  FIDUCIARY_TYPE_OPTIONS,
  type BeneficiaryEntityType,
  type ContactProfile,
  type FiduciaryEntityType,
} from '@/lib/designSheet/fiduciaryDocumentInclusions'
import {
  buildRelationshipPickerOptions,
  legacyRelationshipToStructured,
  structuredFromContactProfile,
  structuredToSelection,
} from '@/lib/kinship/relationshipLabels'
import { contactFullName } from './ContactPicker'

export interface PersonFormValues {
  fiduciary_type?: FiduciaryEntityType
  beneficiary_type?: BeneficiaryEntityType
  first_name: string
  middle_name?: string
  last_name: string
  gender?: string
  date_of_birth?: string
  phone?: string
  email?: string
  address?: string
  relationship_selection?: string
  relationship_custom?: string
  also_beneficiary?: boolean
  also_fiduciary?: boolean
}

interface AddPersonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'fiduciary' | 'beneficiary'
  clientName: string
  spouseName: string
  title: string
  subtitle: string
  initialContact?: MatterContact
  initialProfile?: ContactProfile
  onSave: (values: PersonFormValues) => Promise<void>
}

function emptyForm(mode: 'fiduciary' | 'beneficiary'): PersonFormValues {
  return {
    fiduciary_type: mode === 'fiduciary' ? 'individual' : undefined,
    beneficiary_type: mode === 'beneficiary' ? 'individual' : undefined,
    first_name: '',
    middle_name: '',
    last_name: '',
    gender: '',
    date_of_birth: '',
    phone: '',
    email: '',
    address: '',
    relationship_selection: '',
    relationship_custom: '',
    also_beneficiary: false,
    also_fiduciary: false,
  }
}

function contactToForm(contact: MatterContact, profile?: ContactProfile): PersonFormValues {
  const structured = structuredFromContactProfile(profile)
    ?? legacyRelationshipToStructured(
      profile?.relationship_to ?? 'client',
      profile?.relationship_detail ?? contact.relationship,
    )

  return {
    fiduciary_type: profile?.fiduciary_type ?? 'individual',
    beneficiary_type: profile?.beneficiary_type ?? 'individual',
    first_name: contact.first_name ?? '',
    middle_name: contact.middle_name ?? '',
    last_name: contact.last_name ?? '',
    gender: contact.preferred_pronoun ?? '',
    date_of_birth: profile?.date_of_birth ?? '',
    phone: formatPhoneDisplay(contact.phone) || '',
    email: contact.email ?? '',
    address: contact.address ?? '',
    relationship_selection: structuredToSelection(structured),
    relationship_custom: structured?.kind === 'other' ? structured.custom ?? '' : '',
    also_beneficiary: Boolean(profile?.is_beneficiary),
    also_fiduciary: Boolean(profile?.is_fiduciary),
  }
}

function relationshipOptions(clientName: string, spouseName: string) {
  return buildRelationshipPickerOptions({ clientName, spouseName })
}

function isEntityType(type?: FiduciaryEntityType): boolean {
  return type === 'bank_institutional' || type === 'other_entity'
}

export function AddPersonDialog({
  open,
  onOpenChange,
  mode,
  clientName,
  spouseName,
  title,
  subtitle,
  initialContact,
  initialProfile,
  onSave,
}: AddPersonDialogProps) {
  const [form, setForm] = useState<PersonFormValues>(() => emptyForm(mode))
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(initialContact)

  useEffect(() => {
    if (!open) return
    if (initialContact) {
      setForm(contactToForm(initialContact, initialProfile))
    } else {
      setForm(emptyForm(mode))
    }
  }, [open, initialContact, initialProfile, mode])

  const showIndividualFields = mode === 'beneficiary'
    ? form.beneficiary_type === 'individual'
    : form.fiduciary_type === 'individual' || form.fiduciary_type === 'independent_professional'

  async function handleSubmit() {
    const firstName = form.first_name.trim()
    const lastName = form.last_name.trim() || firstName
    if (!firstName) {
      toast.error('Name is required.')
      return
    }
    setSaving(true)
    try {
      await onSave({
        ...form,
        first_name: firstName,
        last_name: lastName,
        phone: formatPhoneForStorage(form.phone) ?? form.phone,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const relOptions = relationshipOptions(clientName, spouseName)
  const relGroups = useMemo(() => {
    const seen = new Set<string>()
    return relOptions
      .map(opt => opt.group)
      .filter(group => {
        if (seen.has(group)) return false
        seen.add(group)
        return true
      })
  }, [relOptions])
  const showRelationshipCustom = form.relationship_selection === 'other:other'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {mode === 'fiduciary' ? (
            <div className="space-y-1.5">
              <Label>Fiduciary Type *</Label>
              <Select
                value={form.fiduciary_type}
                onValueChange={v => setForm(prev => ({ ...prev, fiduciary_type: v as FiduciaryEntityType }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {FIDUCIARY_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Beneficiary Type *</Label>
              <Select
                value={form.beneficiary_type}
                onValueChange={v => setForm(prev => ({ ...prev, beneficiary_type: v as BeneficiaryEntityType }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {BENEFICIARY_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label>{mode === 'fiduciary' ? "Fiduciary's Name *" : 'Beneficiary Name *'}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="text-xs">Use the full legal name as it should appear in documents.</TooltipContent>
              </Tooltip>
            </div>
            <Input
              value={[form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ') || ''}
              placeholder={
                mode === 'fiduciary' && isEntityType(form.fiduciary_type)
                  ? 'Acme Bank, N.A., through its Private Client Services'
                  : mode === 'fiduciary'
                    ? 'Robert Miller'
                    : 'Beneficiary Name'
              }
              onChange={e => {
                const parts = e.target.value.split(/\s+/).filter(Boolean)
                const first = parts[0] ?? ''
                const last = parts.length > 1 ? parts[parts.length - 1] : ''
                const middle = parts.length > 2 ? parts.slice(1, -1).join(' ') : ''
                setForm(prev => ({ ...prev, first_name: first, middle_name: middle, last_name: last }))
              }}
            />
          </div>

          {showIndividualFields && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>Gender (Optional)</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Used for document pronouns when applicable.</TooltipContent>
                  </Tooltip>
                </div>
                <Select
                  value={form.gender || undefined}
                  onValueChange={v => setForm(prev => ({ ...prev, gender: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="he/him">he/him</SelectItem>
                    <SelectItem value="she/her">she/her</SelectItem>
                    <SelectItem value="they/them">they/them</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Date of Birth (Optional)</Label>
                <Input
                  type="date"
                  value={form.date_of_birth ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, date_of_birth: e.target.value }))}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{mode === 'fiduciary' ? "Fiduciary's Phone Number" : 'Beneficiary Phone'}</Label>
              <Input
                type="tel"
                value={form.phone ?? ''}
                onChange={e => setForm(prev => ({ ...prev, phone: formatPhoneInput(e.target.value) }))}
                placeholder="(555) 555-5555"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{mode === 'fiduciary' ? "Fiduciary's Email Address" : 'Beneficiary Email'}</Label>
              <Input
                type="email"
                placeholder="email@example.com"
                value={form.email ?? ''}
                onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{mode === 'fiduciary' ? "Fiduciary's Address" : 'Beneficiary Address'}</Label>
            <Input
              placeholder="123 Main St, San Jose, CA 94088"
              value={form.address ?? ''}
              onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
            />
          </div>

          {showIndividualFields && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>Relationship</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Pick how this person is related. Documents can show sister for the client and sister-in-law for the spouse automatically.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select
                  value={form.relationship_selection || undefined}
                  onValueChange={v => setForm(prev => ({
                    ...prev,
                    relationship_selection: v,
                    relationship_custom: v === 'other:other' ? prev.relationship_custom : '',
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {relGroups.map(group => (
                      <div key={group}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{group}</div>
                        {relOptions.filter(opt => opt.group === group).map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showRelationshipCustom && (
                <div className="space-y-1.5">
                  <Label>Relationship detail</Label>
                  <Input
                    placeholder="e.g. godparent, neighbor"
                    value={form.relationship_custom ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, relationship_custom: e.target.value }))}
                  />
                </div>
              )}
            </div>
          )}

          {mode === 'fiduciary' ? (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={Boolean(form.also_beneficiary)}
                onCheckedChange={checked => setForm(prev => ({ ...prev, also_beneficiary: checked === true }))}
              />
              <span className="text-sm text-foreground">Also add as a beneficiary</span>
            </label>
          ) : (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={Boolean(form.also_fiduciary)}
                onCheckedChange={checked => setForm(prev => ({ ...prev, also_fiduciary: checked === true }))}
              />
              <span className="text-sm text-foreground">Also add as a fiduciary</span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : mode === 'fiduciary' ? 'Save Fiduciary' : 'Save Beneficiary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function displayContactName(contact: MatterContact): string {
  return contactFullName(contact)
}
