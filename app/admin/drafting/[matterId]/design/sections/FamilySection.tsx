'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { isMinorFromDob } from '@/lib/contacts/childMinor'
import { ageInYearsFromDob } from '@/lib/dob'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  DesignSectionContent,
  DobAgeHint,
  PRONOUN_OPTIONS,
  PrefilledInput,
  PrefilledSelect,
  SectionBlock,
  type SectionProps,
} from './shared'
import type { DesignSheetChild, MatterContact } from '@/types/database'
import { OtherBeneficiariesSection } from './OtherBeneficiariesSection'

function newChild(): DesignSheetChild {
  return { name: '', dob: null, relationship: 'biological', is_minor: false }
}

interface FamilySectionProps extends SectionProps {
  contacts?: MatterContact[]
  onAddContact?: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

export function FamilySection({ sheet, onChange, contacts = [], onAddContact, onUpdateContact }: FamilySectionProps) {
  const children = sheet.children ?? []
  const original = (field: string) => sheet.overrides?.[field]?.original
  const marital = (sheet.marital_status ?? '').toLowerCase()
  const isMarried = marital.includes('married') && !marital.includes('never')
  const clientLabel = (sheet.client_name ?? '').trim() || 'Client'
  const spouseLabel = (sheet.spouse_name ?? '').trim() || 'Spouse / Partner'

  function updateChild(idx: number, patch: Partial<DesignSheetChild>) {
    const next = children.map((c, i) => {
      if (i !== idx) return c
      const updated = { ...c, ...patch }
      // Recompute minor status when DOB changes (preserves explicit is_minor override when only other fields change)
      if (patch.dob !== undefined) {
        updated.is_minor = isMinorFromDob(updated.dob)
      }
      return updated
    })
    onChange('children', next)
  }

  function addChild() {
    onChange('children', [...children, newChild()])
  }

  function removeChild(idx: number) {
    onChange('children', children.filter((_, i) => i !== idx))
  }

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Family information was pre-filled from the client intake. Review children and other beneficiary designations below.
      </AttorneyNoteBanner>

      <div id="design-field-children" tabIndex={-1}>
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
          {children.map((child, idx) => {
            const age = ageInYearsFromDob(child.dob)
            const derivedMinor = isMinorFromDob(child.dob)
            return (
            <div key={idx}>
              {idx > 0 && <Separator className="my-4" />}
              <div className={`flex items-start justify-between ${child.is_minor ? 'rounded-md bg-blue-50/60 dark:bg-blue-950/20 p-3 -m-1' : ''}`}>
                <div className="flex-1">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <PrefilledInput
                      label="Full Name"
                      value={child.name}
                      onChange={v => updateChild(idx, { name: v })}
                    />
                    <div>
                      <PrefilledInput
                        label="Date of Birth"
                        value={child.dob ?? ''}
                        onChange={v => updateChild(idx, { dob: v || null })}
                      />
                      <DobAgeHint dob={child.dob} />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                    {isMarried ? (
                      <PrefilledSelect
                        label="Child of"
                        value={child.parentage ?? 'joint'}
                        options={[
                          { value: 'joint', label: 'Joint (both)' },
                          { value: 'client', label: clientLabel },
                          { value: 'spouse', label: spouseLabel },
                        ]}
                        onChange={v => updateChild(idx, { parentage: v as DesignSheetChild['parentage'] })}
                      />
                    ) : (
                      <PrefilledSelect
                        label="Relationship"
                        value={child.relationship}
                        options={[
                          { value: 'biological', label: 'Biological' },
                          { value: 'adopted', label: 'Adopted' },
                          { value: 'stepchild', label: 'Stepchild' },
                        ]}
                        onChange={v => updateChild(idx, { relationship: v as DesignSheetChild['relationship'] })}
                      />
                    )}
                    <div className="flex items-end gap-3">
                      <Badge variant="outline" className={`text-[11px] ${child.is_minor ? 'border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : ''}`}>
                        {child.is_minor
                          ? (age !== null ? `Minor (age ${age})` : 'Minor')
                          : (age !== null ? `Adult (age ${age})` : 'Adult')}
                      </Badge>
                      {child.dob && child.is_minor !== derivedMinor && (
                        <span className="text-[10px] text-muted-foreground">Override (DOB → {derivedMinor ? 'minor' : 'adult'})</span>
                      )}
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={child.is_minor}
                          onChange={e => updateChild(idx, { is_minor: e.target.checked })}
                          className="h-3 w-3 accent-blue-600"
                        />
                        Treat as minor
                      </label>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeChild(idx)}
                  className="ml-3 mt-6 rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-destructive transition-colors"
                  title="Remove child"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            )
          })}
        </SectionBlock>
      </div>

      <OtherBeneficiariesSection
        sheet={sheet}
        onChange={onChange}
        contacts={contacts}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
        showBanner={false}
      />
    </DesignSectionContent>
  )
}
