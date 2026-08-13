'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  COLLEGE_DPOA_EFFECTIVE_OPTIONS,
  COLLEGE_DPOA_POWER_OPTIONS,
  COLLEGE_FERPA_RECORD_OPTIONS,
  COLLEGE_HIPAA_EXPIRATION_OPTIONS,
  COLLEGE_HIPAA_SCOPE_OPTIONS,
  COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS,
  COLLEGE_LIFE_SUPPORT_OPTIONS,
  COLLEGE_LIVING_WILL_INCLUDE_OPTIONS,
  COLLEGE_ORGAN_DONATION_OPTIONS,
  COLLEGE_TREATMENT_CHOICE_OPTIONS,
  DISCUSS_AT_MEETING,
} from '@/lib/collegePrepFields'
import {
  getCollegePrepDesign,
  setCollegePrepDesign,
  type CollegeDpoaPower,
  type CollegeFerpaRecord,
  type CollegeHipaaCategory,
  type CollegePrepDesign,
} from '@/lib/collegePrepDesign'
import { formatPhoneDisplay } from '@/lib/phone'
import { PlanTrackNotice } from './PlanTrackNotice'
import {
  AttorneyDateInput,
  AttorneyInput,
  ClientDecisionCallout,
  DecisionRow,
  DesignSectionContent,
  DesignSheetCheckboxOption,
  FieldLabel,
  SectionBlock,
  sectionFieldGrid2,
  type SectionProps,
} from './shared'

const YES_NO_UNANSWERED = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const

function yesNoValue(value: boolean | null): 'yes' | 'no' | null {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return null
}

/** A textarea that commits on blur, so every keystroke is not a design-sheet save. */
function NotesField({
  label,
  help,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  help?: string
  value: string | null
  placeholder?: string
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {help ? <p className="mb-2 text-[12px] text-muted-foreground">{help}</p> : null}
      <Textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => onCommit(draft.trim() || null)}
        placeholder={placeholder}
        className="min-h-[90px] resize-y border-border bg-card text-sm leading-relaxed"
        maxLength={4000}
      />
    </div>
  )
}

/**
 * The College Preparation Plan design section.
 *
 * Everything here comes back from the student's questionnaire pre-filled; the
 * attorney's job in this section is to resolve the answers that were deferred
 * ("Discuss at the meeting") and to narrow the scope choices the documents have
 * to state exactly. Deferred answers are called out inline rather than left to
 * look like ordinary selections.
 */
interface CollegePrepSectionProps extends SectionProps {
  matterId: string
  practiceArea: string | null
}

export function CollegePrepSection({ sheet, onChange, matterId, practiceArea }: CollegePrepSectionProps) {
  const design = getCollegePrepDesign(sheet)
  const studentFirst = (sheet.client_name ?? '').trim().split(/\s+/)[0] || 'the student'

  const update = (patch: Partial<CollegePrepDesign>) => {
    onChange('decisions', previous => setCollegePrepDesign(previous, patch))
  }

  const toggleFerpaRecord = (value: CollegeFerpaRecord, checked: boolean) => {
    update({
      ferpa_records: checked
        ? [...design.ferpa_records, value]
        : design.ferpa_records.filter(entry => entry !== value),
    })
  }

  const toggleDpoaPower = (value: CollegeDpoaPower, checked: boolean) => {
    update({
      dpoa_powers: checked
        ? [...design.dpoa_powers, value]
        : design.dpoa_powers.filter(entry => entry !== value),
    })
  }

  const toggleHipaaCategory = (value: CollegeHipaaCategory, checked: boolean) => {
    update({
      hipaa_excluded_categories: checked
        ? [...design.hipaa_excluded_categories, value]
        : design.hipaa_excluded_categories.filter(entry => entry !== value),
    })
  }

  const allDpoaPowers = design.dpoa_powers.length === COLLEGE_DPOA_POWER_OPTIONS.length
  const includeLivingWill = design.living_will_include === 'yes'

  return (
    <DesignSectionContent>
      <PlanTrackNotice matterId={matterId} practiceArea={practiceArea} />

      <SectionBlock
        title="School & Records"
        subtitle="The campus drives which forms providers will accept, and the move-in date is the real deadline."
      >
        <div className={sectionFieldGrid2}>
          <AttorneyInput
            label="School / program"
            value={design.school_name ?? ''}
            onChange={value => update({ school_name: value.trim() || null })}
            fieldName="college_prep.school_name"
          />
          <AttorneyDateInput
            label="Move-in / orientation date"
            value={design.move_in_date ?? ''}
            onChange={value => update({ move_in_date: value || null })}
            fieldName="college_prep.move_in_date"
          />
          <AttorneyInput
            label="Campus city"
            value={design.school_city ?? ''}
            onChange={value => update({ school_city: value.trim() || null })}
            fieldName="college_prep.school_city"
          />
          <AttorneyInput
            label="Campus state"
            value={design.school_state ?? ''}
            onChange={value => update({ school_state: value.trim() || null })}
            fieldName="college_prep.school_state"
          />
        </div>

        <div className="mt-4">
          <DecisionRow
            question="Studying abroad?"
            help="An overseas term is worth a note in the health care documents — foreign providers will not read a Massachusetts proxy."
            value={yesNoValue(design.studying_abroad)}
            options={YES_NO_UNANSWERED}
            onChange={value => update({ studying_abroad: value === 'yes' })}
            fieldName="college_prep.studying_abroad"
          />
          {design.studying_abroad ? (
            <div className="pt-4">
              <AttorneyInput
                label="Country"
                value={design.abroad_country ?? ''}
                onChange={value => update({ abroad_country: value.trim() || null })}
                fieldName="college_prep.abroad_country"
              />
            </div>
          ) : null}

          <DecisionRow
            question="FERPA release"
            help="Education records sit outside HIPAA. The release is drafted from the firm form and, where the school insists, its own portal form."
            value={yesNoValue(design.ferpa_release)}
            options={YES_NO_UNANSWERED}
            onChange={value => update({ ferpa_release: value === 'yes' })}
            fieldName="college_prep.ferpa_release"
          />
        </div>

        {design.ferpa_release ? (
          <div className="mt-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">Records the release covers:</p>
            {COLLEGE_FERPA_RECORD_OPTIONS.map(option => (
              <DesignSheetCheckboxOption
                key={option.value}
                label={option.label}
                checked={design.ferpa_records.includes(option.value)}
                onChange={checked => toggleFerpaRecord(option.value, checked)}
              />
            ))}
            <AttorneyInput
              label="Who may receive the records"
              value={design.ferpa_recipients ?? ''}
              placeholder="e.g. both parents"
              onChange={value => update({ ferpa_recipients: value.trim() || null })}
              fieldName="college_prep.ferpa_recipients"
            />
          </div>
        ) : null}
      </SectionBlock>

      <SectionBlock
        title="Durable Power of Attorney — Scope"
        subtitle="When the authority starts, and what it reaches."
      >
        {design.dpoa_effective === DISCUSS_AT_MEETING ? (
          <ClientDecisionCallout>
            {studentFirst} deferred the effective date to the meeting — choose one before drafting.
          </ClientDecisionCallout>
        ) : null}
        <DecisionRow
          question="Takes effect"
          blocking
          value={design.dpoa_effective}
          options={COLLEGE_DPOA_EFFECTIVE_OPTIONS.map(option => ({
            value: option.value,
            label: option.label,
            description: option.sub || undefined,
          }))}
          onChange={value => update({ dpoa_effective: value })}
          fieldName="college_prep.dpoa_effective"
        />

        <div className="mt-4 space-y-3">
          <p className="text-[12px] text-muted-foreground">Powers granted to the financial agent:</p>
          <DesignSheetCheckboxOption
            label="All powers in this list"
            checked={allDpoaPowers}
            onChange={checked =>
              update({
                dpoa_powers: checked ? COLLEGE_DPOA_POWER_OPTIONS.map(option => option.value) : [],
              })
            }
          />
          {COLLEGE_DPOA_POWER_OPTIONS.map(option => (
            <DesignSheetCheckboxOption
              key={option.value}
              label={option.label}
              checked={design.dpoa_powers.includes(option.value)}
              onChange={checked => toggleDpoaPower(option.value, checked)}
            />
          ))}
        </div>

        <div className="mt-4 space-y-4">
          <NotesField
            label="Withheld or limited"
            help="Anything the agent may not do, in the student's words."
            value={design.dpoa_withheld}
            onCommit={value => update({ dpoa_withheld: value })}
          />
          <NotesField
            label="Drafting notes"
            value={design.dpoa_notes}
            onCommit={value => update({ dpoa_notes: value })}
          />
        </div>
      </SectionBlock>

      <SectionBlock
        title="Health Care Proxy"
        subtitle="Massachusetts allows one agent at a time — name an agent and an alternate in the Agent Designations grid, never co-agents."
      >
        <div className="space-y-4">
          <NotesField
            label="Limits on the agent's authority"
            value={design.hcp_limits}
            placeholder="Optional — the proxy is otherwise unlimited."
            onCommit={value => update({ hcp_limits: value })}
          />
          <NotesField
            label="Religious, cultural, or personal instructions"
            value={design.hcp_instructions}
            onCommit={value => update({ hcp_instructions: value })}
          />
        </div>
      </SectionBlock>

      <SectionBlock
        title="HIPAA Authorization"
        subtitle="What providers may release, to whom, and until when."
      >
        {design.hipaa_scope === DISCUSS_AT_MEETING ? (
          <ClientDecisionCallout>
            {studentFirst} deferred the release scope to the meeting — choose one before drafting.
          </ClientDecisionCallout>
        ) : null}
        <DecisionRow
          question="Information released"
          blocking
          value={design.hipaa_scope}
          options={COLLEGE_HIPAA_SCOPE_OPTIONS.map(option => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={value => update({ hipaa_scope: value })}
          fieldName="college_prep.hipaa_scope"
        />

        {design.hipaa_scope === 'all_except' ? (
          <div className="mt-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">Categories withheld:</p>
            {COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS.map(option => (
              <DesignSheetCheckboxOption
                key={option.value}
                label={option.label}
                checked={design.hipaa_excluded_categories.includes(option.value)}
                onChange={checked => toggleHipaaCategory(option.value, checked)}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-4">
          <DecisionRow
            question="Expires"
            help="HIPAA requires the authorization itself to state an expiration date or event, so this cannot be left open."
            blocking
            value={design.hipaa_expiration}
            options={COLLEGE_HIPAA_EXPIRATION_OPTIONS.map(option => ({
              value: option.value,
              label: option.label,
            }))}
            onChange={value => update({ hipaa_expiration: value })}
            fieldName="college_prep.hipaa_expiration"
          />
          {design.hipaa_expiration === 'date' ? (
            <div className="pt-4">
              <AttorneyDateInput
                label="Expiration date"
                value={design.hipaa_expiration_date ?? ''}
                onChange={value => update({ hipaa_expiration_date: value || null })}
                fieldName="college_prep.hipaa_expiration_date"
              />
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          <FieldLabel>People a provider may talk to</FieldLabel>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Collected on the questionnaire. This grants no decision-making power, so the list is
            usually longer than the proxy nominations. Edit in the intake and re-sync to change it.
          </p>
          {design.hipaa_recipients.length > 0 ? (
            <ul className="space-y-2">
              {design.hipaa_recipients.map(recipient => (
                <li
                  key={recipient.id || recipient.name}
                  className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-foreground">{recipient.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {[
                      recipient.relationship,
                      formatPhoneDisplay(recipient.phone) || null,
                      recipient.email,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No one named yet — confirm at the meeting.
            </p>
          )}
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <FieldLabel>Different scope for different people</FieldLabel>
            <Input
              value={design.hipaa_different_scope ?? ''}
              onChange={event => update({ hipaa_different_scope: event.target.value.trim() || null })}
              placeholder="e.g. billing only for Dad"
            />
          </div>
          <NotesField
            label="Must NOT receive access"
            value={design.excluded_people}
            onCommit={value => update({ excluded_people: value })}
          />
        </div>
      </SectionBlock>

      <SectionBlock
        title="Living Will"
        subtitle="Massachusetts does not give living wills statutory force, but they still tell the health care agent what the student wanted."
      >
        {design.living_will_include === DISCUSS_AT_MEETING ? (
          <ClientDecisionCallout>
            {studentFirst} deferred the living will to the meeting. It stays in the package until
            declined.
          </ClientDecisionCallout>
        ) : null}
        <DecisionRow
          question="Include a living will"
          blocking
          value={design.living_will_include}
          options={COLLEGE_LIVING_WILL_INCLUDE_OPTIONS.map(option => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={value => update({ living_will_include: value })}
          fieldName="college_prep.living_will_include"
        />

        {includeLivingWill ? (
          <>
            <DecisionRow
              question="If there is no reasonable hope of recovery"
              blocking
              value={design.life_support}
              options={COLLEGE_LIFE_SUPPORT_OPTIONS.map(option => ({
                value: option.value,
                label: option.label,
                description: option.sub || undefined,
              }))}
              onChange={value => update({ life_support: value })}
              fieldName="college_prep.life_support"
            />
            <DecisionRow
              question="CPR"
              value={design.cpr}
              options={COLLEGE_TREATMENT_CHOICE_OPTIONS.map(option => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={value => update({ cpr: value })}
              fieldName="college_prep.cpr"
            />
            <DecisionRow
              question="Artificial nutrition and hydration"
              value={design.artificial_nutrition}
              options={COLLEGE_TREATMENT_CHOICE_OPTIONS.map(option => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={value => update({ artificial_nutrition: value })}
              fieldName="college_prep.artificial_nutrition"
            />
            <DecisionRow
              question="Mechanical ventilation"
              value={design.ventilation}
              options={COLLEGE_TREATMENT_CHOICE_OPTIONS.map(option => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={value => update({ ventilation: value })}
              fieldName="college_prep.ventilation"
            />
            <DecisionRow
              question="Comfort care at all times"
              value={yesNoValue(design.comfort_always)}
              options={YES_NO_UNANSWERED}
              onChange={value => update({ comfort_always: value === 'yes' })}
              fieldName="college_prep.comfort_always"
            />
          </>
        ) : null}

        <DecisionRow
          question="Organ donation"
          help="Drafted into the health care proxy's anatomical gift paragraph, whether or not there is a living will."
          value={design.organ_donation}
          options={COLLEGE_ORGAN_DONATION_OPTIONS.map(option => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={value => update({ organ_donation: value })}
          fieldName="college_prep.organ_donation"
        />
        {design.organ_donation === 'specific' ? (
          <div className="pt-4">
            <NotesField
              label="Organs or purposes named"
              value={design.organ_donation_notes}
              onCommit={value => update({ organ_donation_notes: value })}
            />
          </div>
        ) : null}

        <div className="mt-4">
          <NotesField
            label="Other medical notes"
            value={design.other_medical_notes}
            onCommit={value => update({ other_medical_notes: value })}
          />
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}
