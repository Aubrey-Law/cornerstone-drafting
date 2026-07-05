'use client'

import { useCallback, useEffect, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone'
import { deriveTrustName, deriveSpouseTrustName } from '@/lib/designSheetDefaults'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import type { DesignSheet, FiduciaryRole, FiduciarySlot, MatterContact, PipelineMatter, StaggeredTier } from '@/types/database'
import DesignContactPicker, { type Contact as PickerContact } from './ContactPicker'
import type { SlotState } from '@/types/planReview'
import type { SectionProps } from './shared'
import {
  AttorneyInput,
  AttorneySelect,
  ClientDecisionCallout,
  FieldLabel,
  PrefilledInput,
  SectionBlock,
} from './shared'
import { FiduciaryRoleSection } from './FiduciariesSectionEP'
import { WillProvisionsSection } from './WillProvisionsSection'

type Contact = MatterContact

interface DocumentSectionProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

function SectionHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 dark:bg-blue-950/20 dark:border-blue-800/40">
      <p className="text-[11px] text-blue-700 dark:text-blue-300">{children}</p>
    </div>
  )
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

const SLOT_FIELDS: Record<FiduciaryRole, keyof DesignSheet> = {
  trustee: 'trustee_slots',
  executor: 'executor_slots',
  poa: 'poa_slots',
  hcp: 'hcp_slots',
  guardian: 'guardian_slots',
  temporary_guardian: 'temporary_guardian_slots',
}

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

type FiduciarySlotField =
  | 'trustee_slots'
  | 'executor_slots'
  | 'poa_slots'
  | 'hcp_slots'
  | 'guardian_slots'
  | 'temporary_guardian_slots'
  | 'spouse_trustee_slots'
  | 'spouse_executor_slots'
  | 'spouse_poa_slots'
  | 'spouse_hcp_slots'

function SegControl({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
            value === o.value
              ? 'bg-card font-semibold text-primary shadow-sm'
              : 'text-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function isMarried(sheet: DesignSheet) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  return marital.includes('married') && !marital.includes('never')
}

function findSpouseContact(contacts: MatterContact[], matter: PipelineMatter, sheet: DesignSheet): MatterContact | null {
  const spouseName = (sheet.spouse_name ?? matter.spouse_name ?? '').trim()
  if (!spouseName) return null
  const normalized = spouseName.toLowerCase()
  const existing = contacts.find(contact => `${contact.first_name} ${contact.last_name}`.trim().toLowerCase() === normalized)
  if (existing) return existing
  return {
    id: SPOUSE_PRIMARY_CONTACT_ID,
    ...splitDisplayName(spouseName),
    relationship: 'Spouse',
    phone: formatPhoneDisplay(sheet.spouse_phone ?? matter.spouse_phone) || null,
    email: sheet.spouse_email ?? matter.spouse_email ?? null,
    address: matter.spouse_address ?? ([sheet.street, sheet.city, sheet.state, sheet.zip].filter(Boolean).join(', ') || null),
  }
}

function splitDisplayName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first_name: parts[0] ?? name, last_name: '' }
  return {
    first_name: parts.slice(0, -1).join(' '),
    last_name: parts.at(-1) ?? '',
  }
}


function findClientContact(contacts: MatterContact[], matter: PipelineMatter, sheet: DesignSheet): MatterContact | null {
  const clientName = (sheet.client_name ?? matter.client_name ?? '').trim()
  if (!clientName) return null
  const normalized = clientName.toLowerCase()
  const existing = contacts.find(contact => `${contact.first_name} ${contact.last_name}`.trim().toLowerCase() === normalized)
  if (existing) return existing
  return {
    id: CLIENT_PRIMARY_CONTACT_ID,
    ...splitDisplayName(clientName),
    relationship: 'Client',
    phone: formatPhoneDisplay(sheet.client_phone) || null,
    email: sheet.client_email ?? null,
    address: [sheet.street, sheet.city, sheet.state, sheet.zip].filter(Boolean).join(', ') || null,
  }
}

function primaryContactId(slots: FiduciarySlot[] | null | undefined): string | null {
  return slots?.find(slot => slot.order === 0 && !slot.is_co)?.contact_id ?? null
}

function setPrimaryContact(slots: FiduciarySlot[] | null | undefined, contactId: string | null): FiduciarySlot[] {
  const existing = slots ?? []
  const primary = existing.find(slot => slot.order === 0 && !slot.is_co)
  if (!primary) {
    return [
      { id: crypto.randomUUID(), contact_id: contactId, is_co: false, order: 0 },
      ...existing,
    ]
  }
  return existing.map(slot => slot.id === primary.id ? { ...slot, contact_id: contactId } : slot)
}

function clearPrimaryContactIf(slots: FiduciarySlot[] | null | undefined, contactId: string): FiduciarySlot[] {
  return (slots ?? []).map(slot => (
    slot.order === 0 && !slot.is_co && slot.contact_id === contactId
      ? { ...slot, contact_id: null }
      : slot
  ))
}

// Deep-copy a set of fiduciary slots with fresh ids so the destination role
// (e.g. executor) gets an independent, editable copy of the trustee slots.
// Used by the "Same as Trustees" shortcut — a one-time autofill, not a live mirror.
function cloneSlots(slots: FiduciarySlot[] | null | undefined): FiduciarySlot[] {
  return (slots ?? []).map(slot => ({ ...slot, id: crypto.randomUUID() }))
}

function FiduciaryBlock({
  role,
  sheet,
  contacts,
  matter,
  onChange,
  onAddContact,
  onUpdateContact,
  sameAsTrustee,
  onSameAsTrusteeToggle,
  sameAsTrusteeLabel,
  spouseOptionLabel,
  slotField,
  sectionTitle,
  primaryShortcutContact,
  primaryShortcutLabel,
  clientShortcutContact,
  clientShortcutLabel,
  coShortcutContact,
  coShortcutLabel,
}: DocumentSectionProps & {
  role: FiduciaryRole
  sameAsTrustee?: boolean
  onSameAsTrusteeToggle?: () => void
  sameAsTrusteeLabel?: string
  spouseOptionLabel?: string
  slotField?: FiduciarySlotField
  sectionTitle?: string
  primaryShortcutContact?: MatterContact | null
  primaryShortcutLabel?: string
  clientShortcutContact?: MatterContact | null
  clientShortcutLabel?: string
  coShortcutContact?: MatterContact | null
  coShortcutLabel?: string
}) {
  const field = slotField ?? SLOT_FIELDS[role]
  const handleSlotsChange = useCallback((slots: FiduciarySlot[]) => {
    onChange(field, slots as DesignSheet[keyof DesignSheet])
  }, [field, onChange])

  const handleSlotStateChange = useCallback((slotId: string, state: SlotState) => {
    onChange('fiduciary_slot_states', {
      ...(sheet.fiduciary_slot_states ?? {}),
      [slotId]: state,
    })
  }, [onChange, sheet.fiduciary_slot_states])

  const spouseContact = isMarried(sheet) ? findSpouseContact(contacts, matter, sheet) : null
  const clientContact = findClientContact(contacts, matter, sheet)
  // Make the client/spouse pseudo-contacts ('__design_sheet_client__' /
  // '__design_sheet_spouse__') resolvable for display, so a slot that references
  // them (e.g. set by the separate-trust "Initial Trustees" checkbox) renders the
  // person instead of an empty picker.
  const contactsForDisplay = [clientContact, spouseContact]
    .filter((c): c is MatterContact => Boolean(c))
    .reduce<MatterContact[]>((acc, c) => (acc.some(x => x.id === c.id) ? acc : [...acc, c]), contacts)

  return (
    <div id={designFieldTargetId(String(field))} tabIndex={-1}>
      <FiduciaryRoleSection
        role={role}
        slots={(sheet[field] as FiduciarySlot[]) ?? []}
        contacts={contactsForDisplay}
        onSlotsChange={handleSlotsChange}
        onAddContact={data => onAddContact(data as Omit<MatterContact, 'id'>) as Promise<Contact>}
        onUpdateContact={onUpdateContact ? ((id, data) => onUpdateContact(id, data as Omit<MatterContact, 'id'>) as Promise<Contact>) : undefined}
        slotStates={sheet.fiduciary_slot_states}
        onSlotStateChange={handleSlotStateChange}
        sameAsTrustee={sameAsTrustee}
        onSameAsTrusteeToggle={onSameAsTrusteeToggle}
        sameAsTrusteeLabel={sameAsTrusteeLabel}
        // Only offer "spouse as primary" when a label is supplied — the trustee
        // block instead offers spouse as co-trustee (see coShortcutContact).
        spouseContact={spouseOptionLabel ? spouseContact : null}
        spouseOptionLabel={spouseOptionLabel}
        primaryShortcutContact={primaryShortcutContact as Contact | null | undefined}
        primaryShortcutLabel={primaryShortcutLabel}
        clientContact={clientShortcutContact as Contact | null | undefined}
        clientOptionLabel={clientShortcutLabel}
        coShortcutContact={coShortcutContact as Contact | null | undefined}
        coShortcutLabel={coShortcutLabel}
        title={sectionTitle}
      />
    </div>
  )
}

export function TrustDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange, contacts, matter } = props
  const { onAddContact, onUpdateContact } = props
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = isMarried(sheet) ? findSpouseContact(contacts, matter, sheet) : null
  const original = (field: string) => sheet.overrides?.[field]?.original
  const derivedTrustName = deriveTrustName(sheet, matter)
  const derivedSpouseTrustName = deriveSpouseTrustName(sheet, matter)
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const separate = isMarried(sheet) && sheet.is_joint === false
  const showSeparateTrustSelfTrustees = isMarried(sheet) && sheet.is_joint === false && clientContact && spouseContact
  const selfTrusteesChecked = Boolean(
    showSeparateTrustSelfTrustees &&
    primaryContactId(sheet.trustee_slots) === clientContact.id &&
    primaryContactId(sheet.spouse_trustee_slots) === spouseContact.id,
  )

  // Grantor is always an initial trustee: pre-fill the primary trustee slot with
  // the client when it's empty (the firm's standard for revocable trusts).
  useEffect(() => {
    if (!clientContact) return
    if (primaryContactId(sheet.trustee_slots) == null) {
      onChange('trustee_slots', setPrimaryContact(sheet.trustee_slots, clientContact.id) as DesignSheet['trustee_slots'])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientContact?.id])

  const handleSeparateTrustSelfTrusteesToggle = (checked: boolean) => {
    if (!clientContact || !spouseContact) return
    onChange(
      'trustee_slots',
      (checked
        ? setPrimaryContact(sheet.trustee_slots, clientContact.id)
        : clearPrimaryContactIf(sheet.trustee_slots, clientContact.id)) as DesignSheet['trustee_slots'],
    )
    onChange(
      'spouse_trustee_slots',
      (checked
        ? setPrimaryContact(sheet.spouse_trustee_slots, spouseContact.id)
        : clearPrimaryContactIf(sheet.spouse_trustee_slots, spouseContact.id)) as DesignSheet['spouse_trustee_slots'],
    )
  }

  // Residuary "named individuals" — contact picker (reuses the matter contacts).
  const pickerContacts = contacts as unknown as PickerContact[]
  const adaptAdd = (data: Omit<PickerContact, 'id'>) =>
    onAddContact(data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<PickerContact>
  const adaptUpdate = onUpdateContact
    ? (id: string, data: Omit<PickerContact, 'id'>) =>
        onUpdateContact(id, data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<PickerContact>
    : undefined
  const residualContactById = (id: string): PickerContact | null =>
    (contacts.find(c => c.id === id) ?? null) as unknown as PickerContact | null
  const residualIndividuals = sheet.residual_beneficiary_individuals ?? []
  const setResidualIndividuals = (next: string[]) => onChange('residual_beneficiary_individuals', next)

  // Repeatable staggered tiers; mirror the first three ages + numeric amounts
  // into the legacy stagger_* columns so drafting/export/generator keep working.
  const staggers = sheet.staggered_distributions ?? []
  const parseAmt = (a: string | null | undefined): number | null => {
    const m = (a ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*%?$/)
    return m ? parseFloat(m[1]) : null
  }
  const setStaggers = (next: StaggeredTier[]) => {
    onChange('staggered_distributions', next)
    onChange('stagger_age_1', next[0]?.age ?? null)
    onChange('stagger_age_2', next[1]?.age ?? null)
    onChange('stagger_age_3', next[2]?.age ?? null)
    onChange('stagger_pct_1', parseAmt(next[0]?.amount))
    onChange('stagger_pct_2', parseAmt(next[1]?.amount))
  }
  const addStagger = () => setStaggers([...staggers, { id: crypto.randomUUID(), age: null, amount: null }])
  const editStagger = (i: number, patch: Partial<StaggeredTier>) =>
    setStaggers(staggers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  const removeStagger = (i: number) => setStaggers(staggers.filter((_, idx) => idx !== i))

  return (
    <div>
      <SectionHelp>Configure the trust structure, name, protector, trustees, and how the residuary is distributed.</SectionHelp>

      <SectionBlock title="Trust Structure">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Joint Trust?</FieldLabel>
            <SegControl value={sheet.is_joint ? 'yes' : 'no'} options={YES_NO} onChange={v => onChange('is_joint', v === 'yes')} />
          </div>
        </div>
      </SectionBlock>

      <SectionBlock title="Trust Name">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <PrefilledInput
            fieldName="trust_name"
            label={separate ? `${clientFirst || 'Client'}'s Trust` : 'Trust Name'}
            value={sheet.trust_name || derivedTrustName}
            originalValue={original('trust_name')}
            onChange={v => onChange('trust_name', v)}
          />
          {separate && (
            <PrefilledInput
              fieldName="spouse_trust_name"
              label={`${spouseFirst || 'Spouse'}'s Trust`}
              value={sheet.spouse_trust_name || derivedSpouseTrustName}
              originalValue={original('spouse_trust_name')}
              onChange={v => onChange('spouse_trust_name', v || null)}
            />
          )}
        </div>
      </SectionBlock>

      <SectionBlock title="Restatement">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Restatement"
            value={sheet.restatement ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: 'Yes - Restating existing trust' },
              { value: 'no', label: 'No - New trust' },
            ]}
            onChange={v => onChange('restatement', v === 'yes')}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Trust Protector">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Include Trust Protector"
            value={sheet.trust_protector ? 'yes' : 'no'}
            options={YES_NO}
            onChange={v => onChange('trust_protector', v === 'yes')}
          />
          {sheet.trust_protector && (
            <AttorneyInput
              label="Trust Protector Full Name"
              value={sheet.trust_protector_name ?? ''}
              onChange={v => onChange('trust_protector_name', v || null)}
            />
          )}
        </div>
      </SectionBlock>

      {showSeparateTrustSelfTrustees && (
        <SectionBlock title="Initial Trustees">
          <label className="flex items-start gap-2">
            <Checkbox
              checked={selfTrusteesChecked}
              onCheckedChange={checked => handleSeparateTrustSelfTrusteesToggle(checked === true)}
            />
            <span className="text-xs leading-5 text-foreground">
              Name {clientFirst || 'the client'} as initial trustee of {clientFirst ? `${clientFirst}'s` : 'their'} trust and {spouseFirst || 'the spouse'} as initial trustee of {spouseFirst ? `${spouseFirst}'s` : 'their'} trust
            </span>
          </label>
        </SectionBlock>
      )}

      <FiduciaryBlock
        {...props}
        role="trustee"
        sectionTitle={`${clientFirst || 'Client'}'s Trustees`}
        // Separate trusts set initial trustees via the "Initial Trustees" checkbox
        // above, so the per-block self-trustee shortcut is redundant there.
        clientShortcutContact={separate ? null : clientContact}
        clientShortcutLabel={separate ? undefined : `${clientFirst || 'Client'} as initial trustee`}
        coShortcutContact={separate ? null : (isMarried(sheet) ? spouseContact : null)}
        coShortcutLabel={separate ? undefined : `${spouseFirst || 'Spouse'} as initial co-trustee`}
      />
      {separate && (
        <FiduciaryBlock
          {...props}
          role="trustee"
          slotField="spouse_trustee_slots"
          sectionTitle={`${spouseFirst || 'Spouse'}'s Trustees`}
          coShortcutContact={clientContact}
          coShortcutLabel={`${clientFirst || 'Client'} as initial co-trustee`}
        />
      )}

      <SectionBlock title="Residuary Distribution">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Residual Beneficiary"
            value={sheet.residual_beneficiary ?? ''}
            placeholder="Select..."
            options={[
              { value: 'children', label: 'Children' },
              { value: 'descendants', label: 'Descendants' },
              { value: 'named', label: 'Named individuals' },
            ]}
            onChange={v => onChange('residual_beneficiary', v || null)}
          />
          <AttorneySelect
            fieldName="distribution_method"
            label="Distribution Method"
            value={sheet.distribution_method ?? ''}
            placeholder="Select..."
            options={[
              { value: 'staggered', label: 'Staggered (e.g. 1/3 at 25, 30, 35)' },
              { value: 'outright', label: 'Outright at specified age' },
              { value: 'trust-for-life', label: 'Held in trust for lifetime' },
              { value: 'custom', label: 'Custom distribution schedule' },
            ]}
            onChange={v => onChange('distribution_method', v || null)}
          />
        </div>

        {sheet.residual_beneficiary === 'named' && (
          <div className="mt-4">
            <FieldLabel>Named Individuals</FieldLabel>
            <div className="space-y-2">
              {residualIndividuals.map((id, i) => (
                <DesignContactPicker
                  key={`${id}-${i}`}
                  role="Named Individual"
                  value={residualContactById(id)}
                  contacts={pickerContacts}
                  onAddContact={adaptAdd}
                  onUpdateContact={adaptUpdate}
                  onChange={c =>
                    c
                      ? setResidualIndividuals(residualIndividuals.map((x, idx) => (idx === i ? c.id : x)))
                      : setResidualIndividuals(residualIndividuals.filter((_, idx) => idx !== i))
                  }
                />
              ))}
              <DesignContactPicker
                role="Add a named individual"
                value={null}
                contacts={pickerContacts}
                onAddContact={adaptAdd}
                onUpdateContact={adaptUpdate}
                onChange={c => { if (c) setResidualIndividuals([...residualIndividuals, c.id]) }}
              />
            </div>
          </div>
        )}

        {sheet.distribution_method === 'outright' && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <AttorneyInput
              fieldName="distribution_age"
              label="Final Distribution Age"
              value={sheet.distribution_age?.toString() ?? ''}
              placeholder="e.g. 30"
              onChange={v => onChange('distribution_age', parseInt(v) || null)}
            />
          </div>
        )}

        {sheet.distribution_method === 'staggered' && (
          <div className="mt-4">
            <FieldLabel>Staggered Distributions</FieldLabel>
            {staggers.length > 0 && (
              <div className="space-y-2">
                {staggers.map((t, i) => (
                  <div key={t.id ?? i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                    <AttorneyInput label="Amount" value={t.amount ?? ''} placeholder="e.g. 1/3" onChange={v => editStagger(i, { amount: v || null })} />
                    <AttorneyInput label="Age" value={t.age?.toString() ?? ''} placeholder="e.g. 25" onChange={v => editStagger(i, { age: parseInt(v) || null })} />
                    <Button variant="ghost" size="sm" className="mb-0.5 h-9 px-2 text-destructive hover:text-destructive" onClick={() => removeStagger(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" size="sm" className="mt-2 gap-1.5 text-xs" onClick={addStagger}>
              <Plus className="h-3.5 w-3.5" />
              Add Distribution
            </Button>
          </div>
        )}
      </SectionBlock>
    </div>
  )
}

function ExcludedGuardians({ sheet, onChange }: SectionProps) {
  const enabled = Boolean(sheet.excluded_guardian_flag)
  return (
    <SectionBlock title="Excluded Guardian(s)">
      <label className="flex items-start gap-2">
        <Checkbox
          checked={enabled}
          onCheckedChange={checked => {
            const next = checked === true
            onChange('excluded_guardian_flag', next)
            if (!next) onChange('excluded_guardian_name', null)
          }}
        />
        <span className="text-xs leading-5 text-foreground">
          Exclude one or more individuals from serving as guardian
        </span>
      </label>
      {enabled && (
        <div className="mt-4">
          <AttorneyInput
            label="Excluded individual(s) + reason"
            value={sheet.excluded_guardian_name ?? ''}
            placeholder="e.g. Jane Doe — estranged"
            onChange={v => onChange('excluded_guardian_name', v || null)}
          />
        </div>
      )}
    </SectionBlock>
  )
}

export function WillDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange, contacts, matter } = props
  const hasMinors = sheetHasMinorChildren(sheet.children)
  const clientContact = findClientContact(contacts, matter, sheet)
  // Separate trusts give the spouse their own trustee slots; joint trusts share a
  // single set of trustees. Only fall back to trustee_slots for joint trusts —
  // for a separate trust, never substitute the client's trustees for the spouse's.
  const spouseTrusteeSource = sheet.is_joint === false ? sheet.spouse_trustee_slots : sheet.trustee_slots

  return (
    <div>
      <SectionHelp>The Pour-Over Will works with the trust. Configure executor nominations and guardian selections here.</SectionHelp>
      <FiduciaryBlock
        {...props}
        role="executor"
        sameAsTrustee={sheet.executor_same_as_trustee}
        onSameAsTrusteeToggle={() => {
          const next = !sheet.executor_same_as_trustee
          onChange('executor_same_as_trustee', next)
          if (next) onChange('executor_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['executor_slots'])
        }}
        clientShortcutContact={clientContact}
        clientShortcutLabel="Client as primary personal representative"
        spouseOptionLabel="Spouse as personal representative"
      />
      {isMarried(sheet) && (
        <FiduciaryBlock
          {...props}
          role="executor"
          slotField="spouse_executor_slots"
          sectionTitle="Spouse / Partner Personal Representative"
          sameAsTrustee={sheet.spouse_executor_same_as_trustee}
          sameAsTrusteeLabel="Same as Spouse's Trustees"
          onSameAsTrusteeToggle={() => {
            const next = !sheet.spouse_executor_same_as_trustee
            onChange('spouse_executor_same_as_trustee', next)
            if (next) onChange('spouse_executor_slots', cloneSlots(spouseTrusteeSource) as DesignSheet['spouse_executor_slots'])
          }}
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner personal representative"
        />
      )}
      {hasMinors && (
        <>
          <FiduciaryBlock {...props} role="guardian" spouseOptionLabel="Spouse as guardian" />
          <FiduciaryBlock {...props} role="temporary_guardian" spouseOptionLabel="Spouse as temporary guardian" />
          <ExcludedGuardians sheet={sheet} onChange={onChange} />
        </>
      )}
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="will" />
    </div>
  )
}

export function DpoaDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange, contacts, matter } = props
  const clientContact = findClientContact(contacts, matter, sheet)
  // Separate trusts give the spouse their own trustee slots; joint trusts share a
  // single set of trustees. Only fall back to trustee_slots for joint trusts —
  // for a separate trust, never substitute the client's trustees for the spouse's.
  const spouseTrusteeSource = sheet.is_joint === false ? sheet.spouse_trustee_slots : sheet.trustee_slots

  return (
    <div>
      <SectionHelp>Select the agent(s) who will manage financial affairs if the client becomes incapacitated.</SectionHelp>
      <FiduciaryBlock
        {...props}
        role="poa"
        sameAsTrustee={sheet.poa_same_as_trustee}
        onSameAsTrusteeToggle={() => {
          const next = !sheet.poa_same_as_trustee
          onChange('poa_same_as_trustee', next)
          if (next) onChange('poa_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['poa_slots'])
        }}
        spouseOptionLabel="Spouse as DPOA agent"
      />
      {isMarried(sheet) && (
        <FiduciaryBlock
          {...props}
          role="poa"
          slotField="spouse_poa_slots"
          sectionTitle="Spouse / Partner Durable Power of Attorney"
          sameAsTrustee={sheet.spouse_poa_same_as_trustee}
          sameAsTrusteeLabel="Same as Spouse's Trustees"
          onSameAsTrusteeToggle={() => {
            const next = !sheet.spouse_poa_same_as_trustee
            onChange('spouse_poa_same_as_trustee', next)
            if (next) onChange('spouse_poa_slots', cloneSlots(spouseTrusteeSource) as DesignSheet['spouse_poa_slots'])
          }}
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner DPOA agent"
        />
      )}
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="dpoa" />
    </div>
  )
}

export function HealthCareDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange, contacts, matter } = props
  const clientContact = findClientContact(contacts, matter, sheet)

  return (
    <div>
      <SectionHelp>Name the health care proxy and make end-of-life elections under MA law.</SectionHelp>
      <FiduciaryBlock
        {...props}
        role="hcp"
        spouseOptionLabel="Spouse as health care agent"
      />
      {isMarried(sheet) && (
        <FiduciaryBlock
          {...props}
          role="hcp"
          slotField="spouse_hcp_slots"
          sectionTitle="Spouse / Partner Health Care Proxy"
          primaryShortcutContact={clientContact}
          primaryShortcutLabel="Client as spouse / partner health care agent"
        />
      )}
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="healthcare" />
      <SectionBlock title="Advance Health Directive">
        <ClientDecisionCallout>
          Confirm any matter-specific limitations before drafting the living will / advance directive.
        </ClientDecisionCallout>
        <p className="text-sm text-muted-foreground">
          Included with the health care document package when Health Care Documents is checked.
        </p>
      </SectionBlock>
    </div>
  )
}

export function DeedDocumentSection({ sheet, onChange }: SectionProps) {
  const decisions = sheet.decisions ?? {}
  const deed = typeof decisions.deed === 'object' && decisions.deed !== null && !Array.isArray(decisions.deed)
    ? decisions.deed as Record<string, unknown>
    : {}
  const updateDeed = (key: string, value: unknown) => {
    onChange('decisions', {
      ...decisions,
      deed: {
        ...deed,
        [key]: value,
      },
    })
  }

  return (
    <div>
      <SectionHelp>Track whether real property needs to be transferred into the trust.</SectionHelp>
      <SectionBlock title="Deed Work">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Deed Work Needed?</FieldLabel>
            <SegControl value={deed.needed === false ? 'no' : 'yes'} options={YES_NO} onChange={v => updateDeed('needed', v === 'yes')} />
          </div>
          <AttorneySelect
            label="Deed Status"
            value={typeof deed.status === 'string' ? deed.status : 'not_started'}
            options={[
              { value: 'not_started', label: 'Not started' },
              { value: 'information_needed', label: 'Information needed' },
              { value: 'drafted', label: 'Drafted' },
              { value: 'sent_for_signing', label: 'Sent for signing' },
              { value: 'recorded', label: 'Recorded' },
              { value: 'not_applicable', label: 'Not applicable' },
            ]}
            onChange={v => updateDeed('status', v)}
          />
          <div>
            <FieldLabel>Existing Deed Requested / Received?</FieldLabel>
            <SegControl value={deed.existing_deed_received ? 'yes' : 'no'} options={YES_NO} onChange={v => updateDeed('existing_deed_received', v === 'yes')} />
          </div>
          <AttorneyInput
            label="Recording County"
            value={typeof deed.recording_county === 'string' ? deed.recording_county : ''}
            onChange={v => updateDeed('recording_county', v || null)}
          />
        </div>
      </SectionBlock>
      <SectionBlock title="Deed Notes">
        <div className="grid gap-4">
          <div>
            <FieldLabel>Real Property Transfer Notes</FieldLabel>
            <Input value={typeof deed.transfer_notes === 'string' ? deed.transfer_notes : ''} onChange={e => updateDeed('transfer_notes', e.target.value || null)} />
          </div>
          <div>
            <FieldLabel>Funding-to-Trust Notes</FieldLabel>
            <Input value={typeof deed.funding_notes === 'string' ? deed.funding_notes : ''} onChange={e => updateDeed('funding_notes', e.target.value || null)} />
          </div>
          <div>
            <FieldLabel>Follow-up Notes</FieldLabel>
            <Input value={typeof deed.follow_up_notes === 'string' ? deed.follow_up_notes : ''} onChange={e => updateDeed('follow_up_notes', e.target.value || null)} />
          </div>
        </div>
      </SectionBlock>
    </div>
  )
}
