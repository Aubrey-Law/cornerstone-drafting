'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isMinorFromDob } from '@/lib/contacts/childMinor'
import { formatAgeLabel } from '@/lib/dob'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  AttorneySelect,
  DesignSectionContent,
  DobAgeHint,
  FieldLabel,
  SectionBlock,
  sectionFieldGrid3,
  type SectionProps,
} from './shared'
import { DesignField } from '@/components/sharedFields/DesignField'
import { CHILD_RELATIONSHIP_OPTIONS, childParentageOptions, normalizeCitizenship } from '@/lib/sharedFields'
import type { DesignSheetChild } from '@/types/database'

const DECEASED_OPTIONS = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
]

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
]

function newChild(): DesignSheetChild {
  return {
    name: '',
    dob: null,
    gender: null,
    deceased: false,
    relationship: 'biological',
    is_minor: false,
  }
}

export function ClientInformationSection({ sheet, onChange }: SectionProps) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  const isMarried = marital.includes('married') && !marital.includes('never')
  const isDivorced = marital.includes('divorced')
  const isWidowed = marital.includes('widow')
  const original = (field: string) => sheet.overrides?.[field]?.original
  const disinheritedChildren = sheet.disinherited_children ?? []
  const children = sheet.children ?? []
  const clientLabel = (sheet.client_name ?? '').trim() || 'Client'
  const spouseLabel = (sheet.spouse_name ?? '').trim() || 'Spouse / Partner'

  const citizenshipDisplay =
    normalizeCitizenship(sheet.client_citizenship) ?? 'US Citizen'
  const spouseCitizenshipDisplay =
    normalizeCitizenship(sheet.spouse_citizenship) ?? 'US Citizen'

  function updateChild(idx: number, patch: Partial<DesignSheetChild>) {
    const next = children.map((child, i) => {
      if (i !== idx) return child
      const updated = { ...child, ...patch }
      if (patch.dob !== undefined) {
        updated.is_minor = isMinorFromDob(updated.dob)
      }
      return updated
    })
    onChange('children', next)

    if (patch.name !== undefined) {
      const oldName = children[idx]?.name?.trim() ?? ''
      const newName = patch.name.trim()
      if (oldName && oldName !== newName && disinheritedChildren.includes(oldName)) {
        onChange(
          'disinherited_children',
          disinheritedChildren.map(name => (name === oldName ? newName : name)).filter(name => name.trim().length > 0),
        )
      }
    }
  }

  function addChild() {
    onChange('children', [...children, newChild()])
  }

  function removeChild(idx: number) {
    const removedName = children[idx]?.name?.trim() ?? ''
    onChange('children', children.filter((_, i) => i !== idx))
    if (removedName && disinheritedChildren.includes(removedName)) {
      onChange('disinherited_children', disinheritedChildren.filter(name => name !== removedName))
    }
  }

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Fields with a gray background were pre-filled from the client intake questionnaire.
        You can override any value — overridden fields will be highlighted in amber.
        Blank white fields are attorney-only and were not part of the intake.
      </AttorneyNoteBanner>

      <SectionBlock title="Client" subtitle="Primary grantor">
        <div className={sectionFieldGrid3}>
          <DesignField
            fieldId="client_name"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_name')}
          />
          <AttorneyInput
            label="Also Known As (AKA)"
            value={sheet.client_aka ?? ''}
            placeholder="Other names used (used in Wills)"
            onChange={v => onChange('client_aka', v || null)}
          />
        </div>
        <div className={`mt-4 ${sectionFieldGrid3}`}>
          <DesignField
            fieldId="client_pronouns"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_pronouns')}
          />
          <DesignField
            fieldId="marital_status"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('marital_status')}
          />
        </div>
        <div className={`mt-4 ${sectionFieldGrid3}`}>
          <DesignField
            fieldId="client_dob"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_dob')}
            footer={<DobAgeHint dob={sheet.client_dob} />}
          />
          <DesignField
            fieldId="client_phone"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_phone')}
          />
          <DesignField
            fieldId="client_email"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_email')}
          />
        </div>

        {(isDivorced || isWidowed) && (
          <div className={`mt-4 ${sectionFieldGrid3}`}>
            {isDivorced && (
              <AttorneyInput
                label="Former Spouse Name"
                value={sheet.former_spouse_name ?? ''}
                onChange={v => onChange('former_spouse_name', v || null)}
              />
            )}
            {isWidowed && (
              <AttorneyInput
                label="Deceased Spouse Name"
                value={sheet.deceased_spouse_name ?? ''}
                onChange={v => onChange('deceased_spouse_name', v || null)}
              />
            )}
          </div>
        )}

        <div className={`mt-4 ${sectionFieldGrid3}`}>
          <DesignField fieldId="street" sheet={sheet} onChange={onChange} originalValue={original('street')} />
          <DesignField fieldId="city" sheet={sheet} onChange={onChange} originalValue={original('city')} />
          <DesignField fieldId="state" sheet={sheet} onChange={onChange} originalValue={original('state')} />
          <DesignField fieldId="zip" sheet={sheet} onChange={onChange} originalValue={original('zip')} />
        </div>
        <div className={`mt-4 ${sectionFieldGrid3}`}>
          <DesignField fieldId="county" sheet={sheet} onChange={onChange} originalValue={original('county')} />
        </div>
      </SectionBlock>

      {isMarried && (
        <SectionBlock title="Spouse / Partner" subtitle="Co-grantor">
          <div className={sectionFieldGrid3}>
            <DesignField
              fieldId="spouse_name"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_name')}
            />
            <AttorneyInput
              label="Also Known As (AKA)"
              value={sheet.spouse_aka ?? ''}
              placeholder="Other names used (used in Wills)"
              onChange={v => onChange('spouse_aka', v || null)}
            />
          </div>
          <div className={`mt-4 ${sectionFieldGrid3}`}>
            <DesignField
              fieldId="spouse_dob"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_dob')}
              footer={<DobAgeHint dob={sheet.spouse_dob} />}
            />
            <DesignField
              fieldId="spouse_phone"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_phone')}
            />
            <DesignField
              fieldId="spouse_email"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_email')}
            />
          </div>
          <div className={`mt-4 ${sectionFieldGrid3}`}>
            <DesignField
              fieldId="spouse_pronouns"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_pronouns')}
            />
            <DesignField
              fieldId="spouse_citizenship"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_citizenship')}
              valueOverride={spouseCitizenshipDisplay}
            />
          </div>
          <div className={`mt-4 ${sectionFieldGrid3}`}>
            <DesignField
              fieldId="marriage_date"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('marriage_date')}
            />
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Children">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{children.length} children listed</p>
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={addChild}>
            <Plus className="h-3.5 w-3.5" />
            Add Child
          </Button>
        </div>
        {children.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-muted py-8 text-center">
            <p className="text-sm text-muted-foreground">No children listed.</p>
            <Button variant="outline" size="sm" className="mt-3 text-xs gap-1.5" onClick={addChild}>
              <Plus className="h-3.5 w-3.5" />
              Add First Child
            </Button>
          </div>
        )}
        <div className="space-y-2">
          {children.map((child, idx) => {
            const ageLabel = formatAgeLabel(child.dob)
            const derivedMinor = isMinorFromDob(child.dob)
            const isDeceased = Boolean(child.deceased)
            return (
              <div key={idx}>
                <div
                  className={`flex items-start justify-between rounded-lg border border-border p-3 ${
                    isDeceased
                      ? 'bg-muted/60'
                      : child.is_minor
                        ? 'bg-blue-bg'
                        : 'bg-card'
                  }`}
                >
                  <div className="flex-1">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(160px,1.5fr)_150px_90px_130px]">
                      <AttorneyInput
                        label="Full Name"
                        value={child.name}
                        onChange={v => updateChild(idx, { name: v })}
                      />
                      <AttorneyInput
                        label="Date of Birth"
                        type="date"
                        value={child.dob ?? ''}
                        onChange={v => updateChild(idx, { dob: v || null })}
                      />
                      <div>
                        <FieldLabel>Age</FieldLabel>
                        <p className="flex h-9 items-center text-sm text-foreground">{ageLabel ?? '—'}</p>
                      </div>
                      <AttorneySelect
                        label="Deceased"
                        value={child.deceased ? 'yes' : 'no'}
                        options={DECEASED_OPTIONS}
                        onChange={v => updateChild(idx, { deceased: v === 'yes' })}
                      />
                    </div>

                    {!isDeceased && (
                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <AttorneySelect
                          label="Gender"
                          value={child.gender ?? ''}
                          options={GENDER_OPTIONS}
                          onChange={v => updateChild(idx, { gender: (v || null) as DesignSheetChild['gender'] })}
                        />
                        {isMarried ? (
                          <AttorneySelect
                            label="Child of"
                            value={child.parentage ?? 'joint'}
                            options={childParentageOptions({ clientName: clientLabel, spouseName: spouseLabel })}
                            onChange={v => updateChild(idx, { parentage: v as DesignSheetChild['parentage'] })}
                          />
                        ) : (
                          <AttorneySelect
                            label="Relationship"
                            value={child.relationship}
                            options={CHILD_RELATIONSHIP_OPTIONS}
                            onChange={v => updateChild(idx, { relationship: v as DesignSheetChild['relationship'] })}
                          />
                        )}
                        <div className="flex items-end gap-3 md:col-span-2">
                          <span className="text-[11px] text-muted-foreground">
                            {derivedMinor ? 'Minor' : (ageLabel ? 'Adult' : 'Age unknown')}
                          </span>
                          {child.dob && child.is_minor !== derivedMinor && (
                            <span className="text-[10px] text-muted-foreground">
                              Override (DOB → {derivedMinor ? 'minor' : 'adult'})
                            </span>
                          )}
                          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={child.is_minor}
                              onChange={e => updateChild(idx, { is_minor: e.target.checked })}
                              className="h-3 w-3 accent-primary"
                            />
                            Treat as minor
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeChild(idx)}
                    className="ml-3 mt-6 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="Remove child"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </SectionBlock>

      <SectionBlock title="Citizenship & Residency">
        <div className={sectionFieldGrid3}>
          <DesignField
            fieldId="client_citizenship"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_citizenship')}
            valueOverride={citizenshipDisplay}
          />
          <DesignField
            fieldId="client_domicile"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_domicile')}
            valueOverride={sheet.client_domicile || sheet.state || ''}
          />
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}

/** @deprecated Use ClientInformationSection */
export const PersonalSection = ClientInformationSection
