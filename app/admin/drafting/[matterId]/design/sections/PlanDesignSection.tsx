'use client'

import { Plus, Trash2 } from 'lucide-react'
import { DocumentPicker } from '@/components/guided/DocumentPicker'
import { PlanStructurePicker } from '@/components/guided/PlanStructurePicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { DesignSheet, MatterContact, PetCareDetails, RemoteCharity, SpecificBequest } from '@/types/database'
import ContactPicker, { type Contact } from './ContactPicker'
import {
  type DesignDocumentKey,
  getDocumentInclusions,
  getTrustPlanningType,
  setDocumentInclusion,
  setTrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import {
  DESIGN_PLAN_TYPE_OPTIONS,
  normalizeDesignPlanType,
} from '@/lib/designPlanType'
import { Input } from '@/components/ui/input'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  AttorneySelect,
  ClientDecisionCallout,
  FieldLabel,
  SectionBlock,
  type SectionProps,
} from './shared'

interface PlanDesignSectionProps extends SectionProps {
  contacts?: MatterContact[]
  onAddContact?: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  /** LP only — current plan coverage and a setter. Omitted for EP matters. */
  isLP?: boolean
  planCoverage?: 'no_trust' | 'trust_included'
  onPlanCoverageChange?: (coverage: 'no_trust' | 'trust_included') => void
}

export function PlanDesignSection({ sheet, onChange, contacts = [], onAddContact, onUpdateContact, isLP = false, planCoverage = 'no_trust', onPlanCoverageChange }: PlanDesignSectionProps) {
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const inclusions = getDocumentInclusions(sheet)
  const needsDistributionMethod = !sheet.distribution_method
  const isMarried = (sheet.marital_status ?? '').toLowerCase().includes('married')
  // The disclaimer trust is an individual (non-joint) structure for a married
  // client, so only offer it when a spouse exists, the trust is included, and
  // the plan is not a joint trust.
  const showDisclaimerToggle = isMarried && inclusions.trust && !sheet.is_joint
  const isDisclaimerTrust = getTrustPlanningType(sheet) === 'disclaimer'

  const updateDocument = (key: keyof typeof inclusions, checked: boolean) => {
    onChange('decisions', setDocumentInclusion(sheet, key, checked))
  }

  // Disinheritances — plan-wide, edited here (was a broken read-only block in Trust).
  const disinheritances = sheet.disinheritances ?? []
  const updateDisinheritances = (next: NonNullable<DesignSheet['disinheritances']>) =>
    onChange('disinheritances', next)
  const addDisinheritance = () =>
    updateDisinheritances([...disinheritances, { name: '', relationship: '', reason: '' }])
  const editDisinheritance = (i: number, field: 'name' | 'relationship' | 'reason', value: string) =>
    updateDisinheritances(disinheritances.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  const removeDisinheritance = (i: number) =>
    updateDisinheritances(disinheritances.filter((_, idx) => idx !== i))

  // Specific bequests — plan-wide; each carries which document and when it distributes.
  const clientFirst = (sheet.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const documentOptions = [
    { value: 'will', label: 'Will' },
    { value: 'trust', label: 'Trust' },
  ]
  const timingOptions = [
    { value: 'client_death', label: `${clientFirst || 'Client'}'s death` },
    ...(isMarried
      ? [
          { value: 'spouse_death', label: `${spouseFirst || 'Spouse'}'s death` },
          { value: 'survivor_death', label: 'Death of survivor' },
        ]
      : []),
  ]
  const bequests: SpecificBequest[] = sheet.specific_bequests ?? []
  const updateBequest = (idx: number, patch: Partial<SpecificBequest>) => {
    const next = bequests.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange('specific_bequests', next)
  }
  const addBequest = (kind: SpecificBequest['kind']) =>
    onChange('specific_bequests', [...bequests, { id: crypto.randomUUID(), kind } as SpecificBequest])
  const removeBequest = (idx: number) =>
    onChange('specific_bequests', bequests.filter((_, i) => i !== idx))

  const pet: PetCareDetails = sheet.pet_care_details ?? {}
  const updatePet = (patch: Partial<PetCareDetails>) =>
    onChange('pet_care_details', { ...pet, ...patch })

  // Remote beneficiaries — fallback takers if no named beneficiary survives.
  const canPickContacts = Boolean(onAddContact)
  const remoteOptions = [
    { value: 'heirs_at_law', label: 'My heirs at law' },
    ...(isMarried ? [{ value: 'half_heirs_spouse', label: "1/2 my heirs at law, 1/2 spouse's heirs at law" }] : []),
    { value: 'named', label: 'Named individuals / charities' },
  ]
  const contactById = (id: string): Contact | null => (contacts.find(c => c.id === id) ?? null) as Contact | null
  const adaptAdd = (data: Omit<Contact, 'id'>) => onAddContact!(data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<Contact>
  const adaptUpdate = onUpdateContact
    ? (id: string, data: Omit<Contact, 'id'>) => onUpdateContact(id, data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<Contact>
    : undefined
  const remoteIndividuals = sheet.remote_beneficiary_individuals ?? []
  const setRemoteIndividuals = (next: string[]) => onChange('remote_beneficiary_individuals', next)
  const remoteCharities = sheet.remote_beneficiary_charities ?? []
  const setRemoteCharities = (next: RemoteCharity[]) => onChange('remote_beneficiary_charities', next)
  const addRemoteCharity = () => setRemoteCharities([...remoteCharities, { id: crypto.randomUUID(), name: '' }])
  const editRemoteCharity = (i: number, patch: Partial<RemoteCharity>) =>
    setRemoteCharities(remoteCharities.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const removeRemoteCharity = (i: number) =>
    setRemoteCharities(remoteCharities.filter((_, idx) => idx !== i))

  // Signing Date is the single source of truth; derive the month-name / year text
  // the drafting templates still consume so document output is unchanged.
  const handleSigningDateChange = (value: string) => {
    if (!value) {
      onChange('signing_date', null)
      onChange('signing_month', null)
      onChange('signing_year', null)
      return
    }
    onChange('signing_date', value)
    const d = new Date(`${value}T12:00:00`) // local noon avoids TZ off-by-one
    onChange('signing_month', d.toLocaleString('en-US', { month: 'long' }))
    onChange('signing_year', String(d.getFullYear()))
  }

  return (
    <div>
      <AttorneyNoteBanner>
        Select the documents for this matter first. The checked documents control which sections appear below and which drafts are generated.
      </AttorneyNoteBanner>

      <SectionBlock title="Plan Type">
        <PlanStructurePicker
          options={DESIGN_PLAN_TYPE_OPTIONS.map((opt) => ({
            value: opt.value,
            title: opt.label,
          }))}
          selected={normalizedPlanType}
          onSelect={(v) => onChange('plan_type', v)}
          heading="Plan structure"
        />
      </SectionBlock>

      {isLP && onPlanCoverageChange && (
        <SectionBlock title="Plan coverage" subtitle="Which documents this plan covers — drives the client design review's document list.">
          <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
            {(['no_trust', 'trust_included'] as const).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => onPlanCoverageChange(c)}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
                  planCoverage === c
                    ? 'bg-card font-semibold text-primary shadow-sm'
                    : 'text-foreground hover:text-foreground'
                )}
              >
                {c === 'no_trust' ? 'No trust' : 'Trust included'}
              </button>
            ))}
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Documents Included">
        {needsDistributionMethod && (
          <ClientDecisionCallout>distribution method not yet selected</ClientDecisionCallout>
        )}
        <DocumentPicker
          inclusions={inclusions}
          onToggle={(key, checked) => updateDocument(key, checked)}
        />
        {isMarried && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox checked={inclusions.spouse_docs} onCheckedChange={value => updateDocument('spouse_docs', value === true)} />
              <span>
                <span className="block text-sm font-semibold text-foreground">Generate spouse / partner documents</span>
                <span className="block text-xs text-muted-foreground">Applies to Will, DPOA, and Health Care document packages when selected.</span>
              </span>
            </label>
          </div>
        )}
        {showDisclaimerToggle && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox
                checked={isDisclaimerTrust}
                onCheckedChange={value =>
                  onChange('decisions', setTrustPlanningType(sheet, value === true ? 'disclaimer' : 'standard'))
                }
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">Use disclaimer trust structure</span>
                <span className="block text-xs text-muted-foreground">
                  Distributes outright to the surviving spouse, with a Marital (QTIP) / Family (bypass) split created if the
                  spouse disclaims. Replaces the standard individual revocable trust.
                </span>
              </span>
            </label>
          </div>
        )}
      </SectionBlock>

      <SectionBlock title="Disinheritances" subtitle="Individuals specifically excluded from inheriting. Leave empty if none.">
        {disinheritances.length > 0 && (
          <div className="mb-3 space-y-3">
            {disinheritances.map((d, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <AttorneyInput label="Name" value={d.name} onChange={v => editDisinheritance(i, 'name', v)} />
                  <AttorneyInput label="Relationship" value={d.relationship} onChange={v => editDisinheritance(i, 'relationship', v)} />
                  <AttorneyInput label="Reason" value={d.reason} onChange={v => editDisinheritance(i, 'reason', v)} />
                </div>
                <div className="mt-2 flex justify-end">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:text-destructive" onClick={() => removeDisinheritance(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addDisinheritance}>
          <Plus className="h-3.5 w-3.5" />
          Add Disinheritance
        </Button>
      </SectionBlock>

      <SectionBlock title="Tangible Personal Property">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            fieldName="tangible_property_distribution"
            label="Distribution of Tangible Property"
            value={sheet.tangible_property_distribution ?? ''}
            placeholder="Select..."
            options={[
              { value: 'spouse_then_children', label: 'Spouse, then children' },
              { value: 'children_then_descendants', label: 'Children, then descendants' },
              { value: 'named_then_children', label: 'Named individual, then children' },
              { value: 'memorandum', label: 'Personal property memorandum' },
            ]}
            onChange={v => onChange('tangible_property_distribution', v || null)}
          />
          {sheet.tangible_property_distribution === 'named_then_children' && (
            <AttorneyInput
              fieldName="tangible_property_named_individual"
              label="Named Individual"
              value={sheet.tangible_property_named_individual ?? ''}
              onChange={v => onChange('tangible_property_named_individual', v || null)}
            />
          )}
        </div>
      </SectionBlock>

      <SectionBlock title="Remote Beneficiaries" subtitle="Who inherits if none of the named beneficiaries survive.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            fieldName="remote_beneficiary"
            label="Remote Beneficiaries"
            value={sheet.remote_beneficiary ?? ''}
            placeholder="Select..."
            options={remoteOptions}
            onChange={v => onChange('remote_beneficiary', v || null)}
          />
        </div>

        {sheet.remote_beneficiary === 'named' && (
          <div className="mt-4 space-y-5">
            <div>
              <FieldLabel>Named Individuals</FieldLabel>
              {canPickContacts ? (
                <div className="space-y-2">
                  {remoteIndividuals.map((id, i) => (
                    <ContactPicker
                      key={`${id}-${i}`}
                      role="Named Individual"
                      value={contactById(id)}
                      contacts={contacts as unknown as Contact[]}
                      onAddContact={adaptAdd}
                      onUpdateContact={adaptUpdate}
                      onChange={c =>
                        c
                          ? setRemoteIndividuals(remoteIndividuals.map((x, idx) => (idx === i ? c.id : x)))
                          : setRemoteIndividuals(remoteIndividuals.filter((_, idx) => idx !== i))
                      }
                    />
                  ))}
                  <ContactPicker
                    role="Add a named individual"
                    value={null}
                    contacts={contacts as unknown as Contact[]}
                    onAddContact={adaptAdd}
                    onUpdateContact={adaptUpdate}
                    onChange={c => { if (c) setRemoteIndividuals([...remoteIndividuals, c.id]) }}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Open this matter in the drafting workspace to add named individuals.</p>
              )}
            </div>

            <div>
              <FieldLabel>Charities</FieldLabel>
              {remoteCharities.length > 0 && (
                <div className="space-y-3">
                  {remoteCharities.map((c, i) => (
                    <div key={c.id ?? i} className="rounded-lg border border-border bg-muted/40 p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <AttorneyInput label="Charity Name" value={c.name} onChange={v => editRemoteCharity(i, { name: v })} />
                        <AttorneyInput label="Organization Type" value={c.org_type ?? ''} placeholder="e.g. 501(c)(3)" onChange={v => editRemoteCharity(i, { org_type: v || null })} />
                        <AttorneyInput label="State" value={c.state ?? ''} onChange={v => editRemoteCharity(i, { state: v || null })} />
                        <AttorneyInput label="Address" value={c.address ?? ''} onChange={v => editRemoteCharity(i, { address: v || null })} />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <Button variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:text-destructive" onClick={() => removeRemoteCharity(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" className="mt-2 gap-1.5 text-xs" onClick={addRemoteCharity}>
                <Plus className="h-3.5 w-3.5" />
                Add Charity
              </Button>
            </div>
          </div>
        )}
      </SectionBlock>

      <SectionBlock title="Specific Bequests" subtitle="Optional — repeatable list">
        {bequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No specific bequests.</p>
        ) : (
          <div className="space-y-3">
            {bequests.map((b, idx) => (
              <div key={b.id ?? idx} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    {b.kind === 'cash' ? 'Cash Legacy' : b.kind === 'item' ? 'Specific Item' : 'Charitable Bequest'}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => removeBequest(idx)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <AttorneySelect
                    label="In document"
                    value={b.document ?? ''}
                    placeholder="Select..."
                    options={documentOptions}
                    onChange={v => updateBequest(idx, { document: (v || null) as SpecificBequest['document'] })}
                  />
                  <AttorneySelect
                    label="Distribute at"
                    value={b.timing ?? ''}
                    placeholder="Select..."
                    options={timingOptions}
                    onChange={v => updateBequest(idx, { timing: (v || null) as SpecificBequest['timing'] })}
                  />
                </div>
                {b.kind === 'cash' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Amount</FieldLabel>
                      <Input
                        type="number"
                        value={b.amount ?? ''}
                        onChange={e => updateBequest(idx, { amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <AttorneyInput
                      label="Beneficiary Full Name"
                      value={b.beneficiary_name ?? ''}
                      onChange={v => updateBequest(idx, { beneficiary_name: v || null })}
                    />
                  </div>
                )}
                {b.kind === 'item' && (
                  <div className="grid grid-cols-2 gap-3">
                    <AttorneyInput
                      label="Item Description"
                      value={b.item_description ?? ''}
                      onChange={v => updateBequest(idx, { item_description: v || null })}
                    />
                    <AttorneyInput
                      label="Beneficiary Full Name"
                      value={b.beneficiary_name ?? ''}
                      onChange={v => updateBequest(idx, { beneficiary_name: v || null })}
                    />
                  </div>
                )}
                {b.kind === 'charitable' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel>Amount or Property</FieldLabel>
                        <Input
                          type="number"
                          value={b.amount ?? ''}
                          onChange={e => updateBequest(idx, { amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                          className="h-9 text-sm"
                        />
                      </div>
                      <AttorneyInput
                        label="Charity Name"
                        value={b.charity_name ?? ''}
                        onChange={v => updateBequest(idx, { charity_name: v || null })}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <AttorneyInput
                        label="Organization Type"
                        value={b.charity_org_type ?? ''}
                        placeholder="e.g. 501(c)(3)"
                        onChange={v => updateBequest(idx, { charity_org_type: v || null })}
                      />
                      <AttorneyInput
                        label="State of Organization"
                        value={b.charity_state ?? ''}
                        onChange={v => updateBequest(idx, { charity_state: v || null })}
                      />
                      <AttorneyInput
                        label="Charity Address"
                        value={b.charity_address ?? ''}
                        onChange={v => updateBequest(idx, { charity_address: v || null })}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => addBequest('cash')}>
            <Plus className="h-3.5 w-3.5" /> Cash Legacy
          </Button>
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => addBequest('item')}>
            <Plus className="h-3.5 w-3.5" /> Specific Item
          </Button>
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => addBequest('charitable')}>
            <Plus className="h-3.5 w-3.5" /> Charitable
          </Button>
        </div>
      </SectionBlock>

      <SectionBlock title="Pet Care">
        <AttorneySelect
          label="Pet Care Provision"
          value={sheet.pet_care_option ?? 'omit'}
          options={[
            { value: 'omit', label: 'Omit (no pets)' },
            { value: 'direct_bequest', label: 'Direct bequest of pet + cash gift to caretaker' },
            { value: 'pet_trust', label: 'Statutory pet trust under M.G.L. c. 203E §408' },
          ]}
          onChange={v => onChange('pet_care_option', v as 'omit' | 'direct_bequest' | 'pet_trust')}
        />

        {sheet.pet_care_option && sheet.pet_care_option !== 'omit' && (
          <div className="mt-4 grid grid-cols-2 gap-x-6">
            <AttorneySelect
              label="In document"
              value={pet.document ?? ''}
              placeholder="Select..."
              options={documentOptions}
              onChange={v => updatePet({ document: (v || null) as PetCareDetails['document'] })}
            />
          </div>
        )}

        {sheet.pet_care_option === 'direct_bequest' && (
          <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
            <div>
              <FieldLabel>Cash Amount</FieldLabel>
              <Input
                type="number"
                value={pet.cash_amount ?? ''}
                onChange={e => updatePet({ cash_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                className="h-9 text-sm"
              />
            </div>
            <AttorneyInput label="Primary Caretaker" value={pet.primary_caretaker ?? ''} onChange={v => updatePet({ primary_caretaker: v || null })} />
            <AttorneyInput label="Successor Caretaker" value={pet.successor_caretaker ?? ''} onChange={v => updatePet({ successor_caretaker: v || null })} />
          </div>
        )}

        {sheet.pet_care_option === 'pet_trust' && (
          <div className="mt-3">
            <ClientDecisionCallout>Pet trust enforcer is required and easy to forget.</ClientDecisionCallout>
          </div>
        )}
        {sheet.pet_care_option === 'pet_trust' && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <FieldLabel>Cash Amount</FieldLabel>
              <Input
                type="number"
                value={pet.cash_amount ?? ''}
                onChange={e => updatePet({ cash_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                className="h-9 text-sm"
              />
            </div>
            <AttorneyInput label="Pet Trustee" value={pet.pet_trustee ?? ''} onChange={v => updatePet({ pet_trustee: v || null })} />
            <AttorneyInput label="Remainder Beneficiary" value={pet.remainder_beneficiary ?? ''} onChange={v => updatePet({ remainder_beneficiary: v || null })} />
            <AttorneyInput label="Pet Trust Enforcer" value={pet.enforcer ?? ''} onChange={v => updatePet({ enforcer: v || null })} />
          </div>
        )}
      </SectionBlock>

      {/* Execution Mechanics — deferred, not required before drafting */}
      <div className="rounded-lg border border-dashed border-border bg-surface-1 p-6 mb-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-tertiary">Execution Mechanics</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Complete at the signing meeting — not required before drafting</span>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
          <div id="design-field-signing_date" tabIndex={-1}>
            <FieldLabel>Signing Date</FieldLabel>
            <Input
              type="date"
              value={sheet.signing_date ?? ''}
              onChange={e => handleSigningDateChange(e.target.value)}
              className="h-10"
            />
          </div>
          <AttorneyInput
            fieldName="signing_county"
            label="Signing County"
            value={sheet.signing_county ?? ''}
            placeholder="e.g. Middlesex"
            onChange={v => onChange('signing_county', v || null)}
          />
          <AttorneyInput
            fieldName="notary_commission_expiration"
            label="Notary Commission Expiration"
            value={sheet.notary_commission_expiration ?? ''}
            placeholder="MM/DD/YYYY"
            onChange={v => onChange('notary_commission_expiration', v || null)}
          />
        </div>
      </div>
    </div>
  )
}
