'use client'

import { useEffect, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { deriveTrustName, deriveSpouseTrustName } from '@/lib/designSheetDefaults'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import type { DesignSheet, MatterContact, PipelineMatter, StaggeredTier } from '@/types/database'
import DesignContactPicker, { type Contact as PickerContact } from './ContactPicker'
import type { SectionProps } from './shared'
import {
  AttorneyInput,
  AttorneySelect,
  ClientDecisionCallout,
  FieldLabel,
  DesignSectionContent,
  PrefilledInput,
  SectionBlock,
} from './shared'
import {
  SegControl,
  clearPrimaryContactIf,
  findClientContact,
  findSpouseContact,
  isMarriedSheet as isMarried,
  primaryContactId,
  setPrimaryContact,
} from './fiduciary-blocks'
import { WillProvisionsSection } from './WillProvisionsSection'

interface DocumentSectionProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

function SectionHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 dark:bg-blue-950/20 dark:border-blue-800/40">
      <p className="text-[11px] text-blue-700 dark:text-blue-300">{children}</p>
    </div>
  )
}

export function TrustDetailsSection(props: DocumentSectionProps & { scope?: 'client' | 'spouse' }) {
  const { sheet, onChange, contacts, matter, scope = 'client' } = props
  const { onAddContact, onUpdateContact } = props
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = isMarried(sheet) ? findSpouseContact(contacts, matter, sheet) : null
  const original = (field: string) => sheet.overrides?.[field]?.original
  const derivedTrustName = deriveTrustName(sheet, matter)
  const derivedSpouseTrustName = deriveSpouseTrustName(sheet, matter)
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const separate = isMarried(sheet) && sheet.is_joint === false

  if (scope === 'spouse') {
    return (
      <DesignSectionContent>
        <SectionHelp>Configure the spouse&apos;s separate trust name and any spouse-specific trust settings.</SectionHelp>
        <SectionBlock title="Trust Name">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <PrefilledInput
              fieldName="spouse_trust_name"
              label={`${spouseFirst || 'Spouse'}'s Trust`}
              value={sheet.spouse_trust_name || derivedSpouseTrustName}
              originalValue={original('spouse_trust_name')}
              onChange={v => onChange('spouse_trust_name', v || null)}
            />
          </div>
        </SectionBlock>
      </DesignSectionContent>
    )
  }

  const showSeparateTrustSelfTrustees = separate && clientContact && spouseContact
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
    <DesignSectionContent>
      <SectionHelp>Configure the trust structure, name, protector, and how the residuary is distributed. Nominate trustees under Fiduciaries & Additional Contacts.</SectionHelp>

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
    </DesignSectionContent>
  )
}

export function TrustDocumentSection(props: DocumentSectionProps) {
  return <TrustDetailsSection {...props} scope="client" />
}

export function TrustDetailsSpouseSection(props: DocumentSectionProps) {
  return <TrustDetailsSection {...props} scope="spouse" />
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
  const { sheet, onChange } = props
  const hasMinors = sheetHasMinorChildren(sheet.children)

  return (
    <DesignSectionContent>
      <SectionHelp>The Pour-Over Will works with the trust. Configure will-specific provisions here; nominate fiduciaries under Fiduciaries & Additional Contacts.</SectionHelp>
      {hasMinors && <ExcludedGuardians sheet={sheet} onChange={onChange} />}
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="will" />
    </DesignSectionContent>
  )
}

export function DpoaDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange } = props

  return (
    <DesignSectionContent>
      <SectionHelp>Select financial POA provisions. Agent nominations live under Fiduciaries & Additional Contacts.</SectionHelp>
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="dpoa" />
    </DesignSectionContent>
  )
}

export function HealthCareDocumentSection(props: DocumentSectionProps) {
  const { sheet, onChange } = props

  return (
    <DesignSectionContent>
      <SectionHelp>Make end-of-life elections under MA law. Health care agents are nominated under Fiduciaries & Additional Contacts.</SectionHelp>
      <WillProvisionsSection sheet={sheet} onChange={onChange} scope="healthcare" />
      <SectionBlock title="Advance Health Directive">
        <ClientDecisionCallout>
          Confirm any matter-specific limitations before drafting the living will / advance directive.
        </ClientDecisionCallout>
        <p className="text-sm text-muted-foreground">
          Included with the health care document package when Health Care Documents is checked.
        </p>
      </SectionBlock>
    </DesignSectionContent>
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
    <DesignSectionContent>
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
    </DesignSectionContent>
  )
}
