'use client'

import { useState } from 'react'
import { BookOpen, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  AttorneySelect,
  DesignSheetCheckboxOption,
  FieldHelpLabel,
  FieldLabel,
  SectionBlock,
  toYesNo,
  yesNoField,
  type SectionProps,
} from './shared'
import type { AdditionalBeneficiary } from '@/types/database'
import { AssetsSection } from './AssetsSection'
function newAssetTitle() {
  return 'Additional Disinheritance Language'
}

interface PlanStructureFactsSectionProps extends SectionProps {
  /** Asset schedules are their own full-sheet step, so this inventory stays off unless a caller opts in. */
  includeAssets?: boolean
  /** Placement note that only makes sense inside the full Estate Plan Details section. */
  showPlacementNote?: boolean
}

export function PlanStructureFactsSection({
  sheet,
  onChange,
  includeAssets = false,
  showPlacementNote = true,
}: PlanStructureFactsSectionProps) {
  const children = sheet.children ?? []
  const disinheritances = sheet.disinheritances ?? []
  const disinheritedChildren = sheet.disinherited_children ?? []
  const additionalBeneficiaries = sheet.additional_beneficiaries ?? []
  const [additionalLanguage, setAdditionalLanguage] = useState(sheet.additional_disinheritance_language ?? '')
  const namedChildren = children.filter(c => c.name.trim().length > 0)
  function toggleDisinheritedChild(name: string, selected: boolean) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (selected) {
      onChange('disinherited_children', [...new Set([...disinheritedChildren, trimmed])])
      return
    }
    onChange('disinherited_children', disinheritedChildren.filter(n => n !== trimmed))
  }

  function addDisinheritance() {
    onChange('disinheritances', [...disinheritances, { name: '', relationship: '', reason: '' }])
  }

  function editDisinheritance(i: number, field: 'name' | 'relationship', value: string) {
    onChange(
      'disinheritances',
      disinheritances.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)),
    )
  }

  function removeDisinheritance(i: number) {
    onChange('disinheritances', disinheritances.filter((_, idx) => idx !== i))
  }

  function addAdditionalBeneficiary() {
    onChange('additional_beneficiaries', [
      ...additionalBeneficiaries,
      { id: crypto.randomUUID(), name: '', relationship: null, kind: 'individual' },
    ])
  }

  function editAdditionalBeneficiary(i: number, patch: Partial<AdditionalBeneficiary>) {
    onChange(
      'additional_beneficiaries',
      additionalBeneficiaries.map((entry, idx) => (idx === i ? { ...entry, ...patch } : entry)),
    )
  }

  function removeAdditionalBeneficiary(i: number) {
    onChange('additional_beneficiaries', additionalBeneficiaries.filter((_, idx) => idx !== i))
  }

  return (
    <>
      {showPlacementNote && (
        <AttorneyNoteBanner>
          Children options and disinheritance details remain in the Estate Plan Details section.
        </AttorneyNoteBanner>
      )}

      <SectionBlock title="Children Options">
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="Include child gender markers"
            description="If selected, the trust will include the gender of each child when enumerating the settlors' children."
            checked={yesNoField(sheet.include_child_gender_markers)}
            onChange={checked => onChange('include_child_gender_markers', toYesNo(checked))}
          />
          <DesignSheetCheckboxOption
            label="Include afterborn children"
            description="Include language stating that any children born to the settlors after the trust is executed should be treated as if they were listed explicitly in the trust."
            checked={yesNoField(sheet.include_afterborn_children)}
            onChange={checked => onChange('include_afterborn_children', toYesNo(checked))}
          />
          <DesignSheetCheckboxOption
            label="Include posthumous children"
            description="Include posthumous children (in gestation at the time of the first settlor's death) as though they were explicitly named in the trust."
            checked={yesNoField(sheet.include_expectant_children)}
            onChange={checked => onChange('include_expectant_children', toYesNo(checked))}
          />
          <DesignSheetCheckboxOption
            label="Omissions intentional"
            description="Include language stating that any omitted children were intentionally left out (with the exception of afterborn children, if applicable). This is a safety net — to disinherit a specific child, explicitly disinherit them below."
            checked={yesNoField(sheet.omissions_intentional)}
            onChange={checked => onChange('omissions_intentional', toYesNo(checked))}
          />
        </div>
      </SectionBlock>

      <div id="design-field-disinherited-heirs" tabIndex={-1}>
        <SectionBlock title="Disinherited Heirs">
          <FieldHelpLabel help="To disinherit a child, select the option to disinherit a specific child and select them from the list of options. To disinherit someone else, add them to the list of disinherited heirs.">
            How to disinherit
          </FieldHelpLabel>

          <div className="mt-5">
            <FieldLabel>Disinherited Children</FieldLabel>
            {namedChildren.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add children in Intake Details to select who should be disinherited.</p>
            ) : (
              <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
                {namedChildren.map((child, idx) => {
                  const name = child.name.trim()
                  const selected = disinheritedChildren.includes(name)
                  return (
                    <label key={`${name}-${idx}`} className="flex cursor-pointer items-center gap-2.5">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={value => toggleDisinheritedChild(name, value === true)}
                      />
                      <span className="text-sm text-foreground">{name}</span>
                      {child.deceased && (
                        <Badge variant="outline" className="text-micro">
                          Deceased
                        </Badge>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-6">
            <FieldLabel>Disinherited Heirs</FieldLabel>
            <p className="mb-3 text-xs text-muted-foreground">Enter the name and relationship of any additional disinherited heir.</p>
            {disinheritances.length > 0 && (
              <div className="mb-3 space-y-3">
                {disinheritances.map((d, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <AttorneyInput label="Name" value={d.name} onChange={v => editDisinheritance(i, 'name', v)} />
                      <AttorneyInput
                        label="Relationship"
                        value={d.relationship}
                        onChange={v => editDisinheritance(i, 'relationship', v)}
                      />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs text-destructive hover:text-destructive"
                        onClick={() => removeDisinheritance(i)}
                      >
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
              Add Disinherited Heir
            </Button>
          </div>

          <div className="mt-6 space-y-3">
            <DesignSheetCheckboxOption
              label="Disinherit issue"
              description="Select this option to disinherit issue of any disinherited heir or child."
              checked={yesNoField(sheet.disinherit_issue)}
              onChange={checked => onChange('disinherit_issue', toYesNo(checked))}
            />
            <DesignSheetCheckboxOption
              label="General disinheritance language"
              description="Include standard language that any omitted heirs were intentionally left out of the estate plan."
              checked={yesNoField(sheet.include_general_disinheritance)}
              onChange={checked => onChange('include_general_disinheritance', toYesNo(checked))}
            />
          </div>

          <div className="mt-6">
            <FieldLabel>{newAssetTitle()}</FieldLabel>
            <p className="mb-2 text-xs text-muted-foreground">
              State any additional context or language related to the disinheritance. This text will appear as a
              paragraph in the disinheritance section of the trust and/or will.
            </p>
            <Textarea
              value={additionalLanguage}
              onChange={e => setAdditionalLanguage(e.target.value)}
              onBlur={() => onChange('additional_disinheritance_language', additionalLanguage.trim() || null)}
              placeholder="Optional custom disinheritance language…"
              className="min-h-[100px] resize-y border-border bg-card text-sm leading-relaxed"
              maxLength={4000}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
                <BookOpen className="h-3.5 w-3.5" />
                Clause Library
              </Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
                <Sparkles className="h-3.5 w-3.5" />
                Draft with AI
              </Button>
            </div>
            <p className="mt-1.5 text-micro text-muted-foreground">Saved automatically on blur.</p>
          </div>
        </SectionBlock>
      </div>

      <div id="design-field-additional-beneficiaries" tabIndex={-1}>
        <SectionBlock title="Additional Beneficiaries">
          <DesignSheetCheckboxOption
            label="Additional Beneficiaries"
            description="Please list all of your client's beneficiaries below, including anyone who will receive a gift or be a beneficiary of a residual distribution. This includes individuals, groups of individuals, and charities."
            checked={yesNoField(sheet.include_additional_beneficiaries)}
            onChange={checked => onChange('include_additional_beneficiaries', toYesNo(checked))}
          />

          {yesNoField(sheet.include_additional_beneficiaries) && (
            <div className="mt-4 space-y-3">
              {additionalBeneficiaries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No additional beneficiaries listed.</p>
              ) : (
                additionalBeneficiaries.map((entry, i) => (
                  <div key={entry.id ?? i} className="rounded-lg border border-border bg-muted p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <AttorneyInput
                        label="Name"
                        value={entry.name}
                        onChange={v => editAdditionalBeneficiary(i, { name: v })}
                      />
                      <AttorneySelect
                        label="Type"
                        value={entry.kind}
                        options={[
                          { value: 'individual', label: 'Individual' },
                          { value: 'group', label: 'Group of individuals' },
                          { value: 'charity', label: 'Charity' },
                        ]}
                        onChange={v => editAdditionalBeneficiary(i, { kind: v as AdditionalBeneficiary['kind'] })}
                      />
                      <AttorneyInput
                        label="Relationship / Role"
                        value={entry.relationship ?? ''}
                        onChange={v => editAdditionalBeneficiary(i, { relationship: v || null })}
                      />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs text-destructive hover:text-destructive"
                        onClick={() => removeAdditionalBeneficiary(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addAdditionalBeneficiary}>
                <Plus className="h-3.5 w-3.5" />
                Add Beneficiary
              </Button>
            </div>
          )}
        </SectionBlock>
      </div>

      {includeAssets && <AssetsSection sheet={sheet} onChange={onChange} />}
    </>
  )
}
