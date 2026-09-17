'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { MatterContact, RemoteCharity, SpecificBequest } from '@/types/database'
import ContactPicker, { type Contact } from './ContactPicker'
import {
  AttorneyInput,
  AttorneySelect,
  FieldLabel,
  SectionBlock,
  type SectionProps,
} from './shared'

interface TrustBeneficiariesSectionProps extends SectionProps {
  contacts?: MatterContact[]
  onAddContact?: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  /** When true, only render specific bequests (no remote beneficiaries wrapper). */
  specificBequestsOnly?: boolean
  /** When true, only render remote beneficiaries (no specific bequests wrapper). */
  remoteBeneficiariesOnly?: boolean
}

export function TrustBeneficiariesSection({
  sheet,
  onChange,
  contacts = [],
  onAddContact,
  onUpdateContact,
  specificBequestsOnly = false,
  remoteBeneficiariesOnly = false,
}: TrustBeneficiariesSectionProps) {
  const isMarried = sheet.matter_type === 'couple'
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

  const showRemote = !specificBequestsOnly
  const showBequests = !remoteBeneficiariesOnly

  return (
    <>
      {showRemote && (
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
                    <div key={c.id ?? i} className="rounded-lg border border-border bg-muted p-3">
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
      )}

      {showBequests && (
      <SectionBlock title="Specific Bequests" subtitle="Optional — repeatable list of cash legacies, specific items, and charitable bequests.">
        {bequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No specific bequests.</p>
        ) : (
          <div className="space-y-3">
            {bequests.map((b, idx) => (
              <div key={b.id ?? idx} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-micro font-bold uppercase tracking-[0.12em] text-muted-foreground">
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
      )}
    </>
  )
}
