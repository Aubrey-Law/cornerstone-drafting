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
  COLLEGE_SIGNING_PREFERENCE_OPTIONS,
  COLLEGE_TREATMENT_CHOICE_OPTIONS,
  namedHipaaRecipients,
} from '@/lib/collegePrepFields'
import { formatPhoneDisplay } from '@/lib/phone'

type Row = [string, string]

export interface CollegePrepReviewSection {
  /** Step id, so the review's "Edit" control can jump straight back. */
  sectionId: string
  title: string
  rows: Row[]
}

type Option = { value: string; label: string }

function labelFor(options: readonly Option[], value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  return options.find((option) => option.value === value)?.label ?? value
}

function labelsFor(options: readonly Option[], value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  return value
    .map((entry) => labelFor(options, entry))
    .filter(Boolean)
    .join(', ')
}

function text(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? (data[key] as string).trim() : ''
}

function yesNo(value: unknown): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return ''
}

function rows(entries: Array<[string, string]>): Row[] {
  return entries.filter(([, value]) => value.trim().length > 0)
}

/**
 * Summary rows for the College Preparation Plan answers, in the same order the
 * questionnaire asks them. Sections with nothing filled in are dropped so the
 * review reads as a summary rather than a form printout.
 */
export function collegePrepReviewSections(
  data: Record<string, unknown>,
): CollegePrepReviewSection[] {
  const recipients = namedHipaaRecipients(data.college_hipaa_recipients)

  const sections: CollegePrepReviewSection[] = [
    {
      sectionId: 'cp_school',
      title: 'School',
      rows: rows([
        ['School / program', text(data, 'college_school_name')],
        [
          'Campus',
          [text(data, 'college_school_city'), text(data, 'college_school_state')]
            .filter(Boolean)
            .join(', '),
        ],
        ['Move-in / orientation', text(data, 'college_move_in_date')],
        ['Studying abroad', yesNo(data.college_studying_abroad)],
        ['Abroad — country', text(data, 'college_abroad_country')],
        ['FERPA release', yesNo(data.college_ferpa_release)],
        ['FERPA records', labelsFor(COLLEGE_FERPA_RECORD_OPTIONS, data.college_ferpa_records)],
        ['FERPA recipients', text(data, 'college_ferpa_recipients')],
      ]),
    },
    {
      sectionId: 'cp_parents',
      title: 'Family circumstances',
      rows: rows([['Notes', text(data, 'college_family_circumstances')]]),
    },
    {
      sectionId: 'cp_agents',
      title: 'HIPAA recipients',
      rows: rows([
        ...recipients.map((recipient): Row => [
          recipient.name.trim(),
          [
            recipient.relationship?.trim(),
            formatPhoneDisplay(recipient.phone) || null,
            recipient.email?.trim(),
          ]
            .filter(Boolean)
            .join(' · ') || 'May receive medical information',
        ]),
        ['Should NOT receive access', text(data, 'college_excluded_people')],
      ]),
    },
    {
      sectionId: 'cp_dpoa',
      title: 'Power of attorney — scope',
      rows: rows([
        ['Takes effect', labelFor(COLLEGE_DPOA_EFFECTIVE_OPTIONS, data.college_dpoa_effective)],
        ['Powers granted', labelsFor(COLLEGE_DPOA_POWER_OPTIONS, data.college_dpoa_powers)],
        ['Withheld or limited', text(data, 'college_dpoa_withheld')],
        ['Notes', text(data, 'college_dpoa_notes')],
      ]),
    },
    {
      sectionId: 'cp_healthcare',
      title: 'Health care proxy',
      rows: rows([
        ["Limits on the agent's authority", text(data, 'college_hcp_limits')],
        ['Religious, cultural, or personal instructions', text(data, 'college_hcp_instructions')],
      ]),
    },
    {
      sectionId: 'cp_hipaa',
      title: 'HIPAA authorization',
      rows: rows([
        ['Information released', labelFor(COLLEGE_HIPAA_SCOPE_OPTIONS, data.college_hipaa_scope)],
        [
          'Withheld categories',
          labelsFor(COLLEGE_HIPAA_SENSITIVE_CATEGORY_OPTIONS, data.college_hipaa_excluded_categories),
        ],
        ['Different scope for different people', text(data, 'college_hipaa_different_scope')],
        ['Expires', labelFor(COLLEGE_HIPAA_EXPIRATION_OPTIONS, data.college_hipaa_expiration)],
        ['Expiration date', text(data, 'college_hipaa_expiration_date')],
      ]),
    },
    {
      sectionId: 'cp_living_will',
      title: 'Living will',
      rows: rows([
        ['Include a living will', labelFor(COLLEGE_LIVING_WILL_INCLUDE_OPTIONS, data.college_living_will_include)],
        ['If no reasonable hope of recovery', labelFor(COLLEGE_LIFE_SUPPORT_OPTIONS, data.college_life_support)],
        ['CPR', labelFor(COLLEGE_TREATMENT_CHOICE_OPTIONS, data.college_cpr)],
        ['Artificial nutrition and hydration', labelFor(COLLEGE_TREATMENT_CHOICE_OPTIONS, data.college_artificial_nutrition)],
        ['Mechanical ventilation', labelFor(COLLEGE_TREATMENT_CHOICE_OPTIONS, data.college_ventilation)],
        ['Comfort care at all times', yesNo(data.college_comfort_always)],
        ['Organ donation', labelFor(COLLEGE_ORGAN_DONATION_OPTIONS, data.college_organ_donation)],
        ['Organ donation notes', text(data, 'college_organ_donation_notes')],
        ['Other medical notes', text(data, 'college_other_medical_notes')],
      ]),
    },
    {
      sectionId: 'cp_other',
      title: 'Other matters',
      rows: rows([
        ['Signing preference', labelFor(COLLEGE_SIGNING_PREFERENCE_OPTIONS, data.college_signing_preference)],
        ['Copies to', text(data, 'college_copy_recipients')],
        ['Concerns', text(data, 'college_concerns')],
      ]),
    },
  ]

  return sections.filter((section) => section.rows.length > 0)
}
