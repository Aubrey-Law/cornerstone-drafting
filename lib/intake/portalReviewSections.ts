import { formatDateOnly } from '@/lib/dob'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { formatPhoneDisplay } from '@/lib/phone'
import {
  fiduciaryReviewTitle,
  intakeReviewRow,
  isIntakeReviewFieldKey,
  type IntakeReviewFieldKey,
} from '@/lib/sharedFields/reviewDisplay'
import { collegePrepReviewSections } from '@/lib/collegePrepReview'
import { getIntakeTrack } from '@/lib/intakeTrack'

/**
 * The portal review screen's content, as data.
 *
 * `IntakeQuestionnaireReview` renders these helpers directly, and the client's
 * Word export prints the sections this module builds — so "a copy of what I
 * submitted" stays the same set of questions the client just read on screen.
 * Nothing here may import React or touch the DOM: the export runs on the
 * server.
 */

export interface FiduciaryEntry {
  first_name: string
  last_name: string
  relationship: string
  priority: number
  is_coagent?: boolean
}

export interface ChildEntry {
  id?: string
  first_name: string
  last_name: string
  date_of_birth: string
}

export interface AdditionalContactEntry {
  id: string
  first_name: string
  last_name: string
  relationship?: string
  phone?: string
  email?: string
  street?: string
  city?: string
  state?: string
  zip?: string
  address?: string
}

interface RealEstateItem {
  id: string
}

interface AssetTotals {
  client_total: string
  spouse_total: string
  joint_total: string
}

// ── Value formatting (shared with the on-screen review) ──────────────────────

export function formatLegacyReviewValue(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value).trim()
}

export function reviewRows(
  entries: Array<[IntakeReviewFieldKey, unknown] | [string, unknown]>,
): [string, string][] {
  return entries
    .map((entry) => {
      const [key, value] = entry
      if (isIntakeReviewFieldKey(key)) {
        return intakeReviewRow(key, value)
      }
      const text = formatLegacyReviewValue(value)
      if (!text) return null
      return [key, text] as [string, string]
    })
    .filter((row): row is [string, string] => row !== null)
}

export function summarizeRealEstate(data: Record<string, unknown>): string | null {
  const items = data.financial_real_estate as RealEstateItem[] | undefined
  if (!items?.length) return null
  return `${items.length} ${items.length === 1 ? 'property' : 'properties'} listed`
}

export function summarizeItemList(
  data: Record<string, unknown>,
  key: string,
  singular: string,
  plural: string,
): string | null {
  const items = data[`financial_${key}`]
  if (!Array.isArray(items) || items.length === 0) return null
  return `${items.length} ${items.length === 1 ? singular : plural} listed`
}

export function summarizeAssetTotals(data: Record<string, unknown>, key: string): string | null {
  const totals = data[`financial_${key}`] as AssetTotals | undefined
  if (!totals) return null
  const parts = [
    totals.client_total && `Client: ${totals.client_total}`,
    totals.spouse_total && `Spouse: ${totals.spouse_total}`,
    totals.joint_total && `Joint: ${totals.joint_total}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

/**
 * Render a stored date answer as a readable one — `1972-04-08` → `Apr 8, 1972`.
 *
 * Only a value that is *entirely* an ISO date is treated as a date. Prose that
 * merely mentions one ("we signed on 2020-01-15") is a client's own wording and
 * is left exactly as they typed it.
 */
export function formatReviewDateValue(value: string): string {
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return value

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))

  // An out-of-range value rolls over rather than failing — Date.UTC turns
  // 2020-13-45 into 14 Feb 2021. Showing a client a date of birth they never
  // entered is worse than showing them the value as stored, so anything that
  // does not round-trip is passed through untouched.
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return value
  }

  return formatDateOnly(trimmed)
}

export function fiduciaryLabel(entry: FiduciaryEntry): string {
  if (entry.is_coagent) return `Co-agent ${entry.priority}`
  return entry.priority === 1 ? 'Primary' : `Alternate ${entry.priority - 1}`
}

/** The named entries of a fiduciary bucket, as the review lists them. */
export function namedFiduciaries(data: Record<string, unknown>, key: string): FiduciaryEntry[] {
  const entries = data[key] as FiduciaryEntry[] | undefined
  return (entries ?? []).filter(
    (entry) => entry.first_name?.trim() || entry.last_name?.trim(),
  )
}

export function additionalContactLine(row: AdditionalContactEntry): string {
  const address =
    composedAddressOneLine({
      street: (row.street ?? '').trim(),
      city: (row.city ?? '').trim(),
      state: (row.state ?? '').trim(),
      zip: (row.zip ?? '').trim(),
    }) || (typeof row.address === 'string' ? row.address.trim() : '')

  const name = [row.first_name, row.last_name].map((p) => (p ?? '').trim()).filter(Boolean).join(' ')
  const withRelationship = row.relationship?.trim() ? `${name} (${row.relationship.trim()})` : name
  const detail = [address || null, formatPhoneDisplay(row.phone) || null, row.email?.trim() || null]
    .filter(Boolean)
    .join(' · ')

  return detail ? `${withRelationship} — ${detail}` : withRelationship
}

// ── Section assembly ─────────────────────────────────────────────────────────

/** A label/value section, as the review's bordered cards render them. */
export interface PortalReviewFieldSection {
  kind: 'fields'
  title: string
  rows: [string, string][]
}

/** A list section (children, contacts, fiduciaries) as one line per entry. */
export interface PortalReviewEntrySection {
  kind: 'entries'
  title: string
  entries: string[]
}

export type PortalReviewSection = PortalReviewFieldSection | PortalReviewEntrySection

function fields(title: string, rows: [string, string][]): PortalReviewFieldSection | null {
  return rows.length ? { kind: 'fields', title, rows } : null
}

function entries(title: string, lines: string[]): PortalReviewEntrySection | null {
  const kept = lines.map((line) => line.trim()).filter(Boolean)
  return kept.length ? { kind: 'entries', title, entries: kept } : null
}

/**
 * Build the review screen's sections from an intake row.
 *
 * Section order, titles, and visibility rules mirror
 * `IntakeQuestionnaireReview` — including the College Preparation Plan track,
 * which replaces the estate sections with its own and asks for agents rather
 * than trustees. The on-screen checklist and the upload summary are
 * deliberately absent: both are workflow affordances, not answers.
 */
export function buildPortalReviewSections(
  data: Record<string, unknown>,
): PortalReviewSection[] {
  const isCollegePrep = getIntakeTrack(data) === 'college_prep'
  const spouse = data._spouse as Record<string, string> | undefined
  const children = data._children as ChildEntry[] | undefined
  const objectives = (data.planning_objectives as Record<string, string> | undefined) ?? {}
  const referralSource = data.referral_source as string | undefined

  const additionalNominees = ((data._additional_contacts as AdditionalContactEntry[]) ?? []).filter(
    (row) => {
      const first = typeof row.first_name === 'string' ? row.first_name.trim() : ''
      const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
      return first.length > 0 || last.length > 0
    },
  )

  const fiduciarySection = (intakeLocalKey: string): PortalReviewEntrySection | null => {
    const named = namedFiduciaries(data, intakeLocalKey)
    return entries(
      fiduciaryReviewTitle(intakeLocalKey),
      named.map((entry) => {
        const name = [entry.first_name, entry.last_name]
          .map((p) => (p ?? '').trim())
          .filter(Boolean)
          .join(' ')
        const relationship = entry.relationship?.trim() ? ` (${entry.relationship.trim()})` : ''
        return `${fiduciaryLabel(entry)}: ${name}${relationship}`
      }),
    )
  }

  const sections: Array<PortalReviewSection | null> = []

  if (!isCollegePrep && referralSource) {
    sections.push(fields('Getting Started', reviewRows([
      ['referral_source', referralSource],
      ['referral_name', data.referral_name],
      ['legal_insurance_plan', data.legal_insurance_plan],
      ['legal_insurance_member_id', data.legal_insurance_member_id],
    ])))
  }

  sections.push(fields(
    isCollegePrep ? 'Student Information' : 'Personal Information',
    reviewRows([
      ['client_name', `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim()],
      ['preferred_name', data.preferred_name],
      ['date_of_birth', data.date_of_birth],
      ['email', data.email],
      ['phone', data.phone],
      ['address', [data.street_address, data.city, data.state, data.zip].filter(Boolean).join(', ')],
      ['county', data.county],
      ['is_us_citizen', data.is_us_citizen],
    ]),
  ))

  if (!isCollegePrep) {
    sections.push(fields('Family', reviewRows([
      ['marital_status', data.marital_status],
      ['has_children', data.has_children],
      ['has_minor_children', data.has_minor_children],
    ])))

    if (spouse) {
      sections.push(fields('Spouse', reviewRows([
        ['spouse_name', `${spouse.first_name ?? ''} ${spouse.last_name ?? ''}`.trim()],
        ['spouse_dob', spouse.date_of_birth],
        ['spouse_email', spouse.email],
        ['spouse_phone', spouse.phone],
      ])))
    }

    if (children && children.length > 0) {
      sections.push(entries('Children', children.map((child) => {
        const name = [child.first_name, child.last_name]
          .map((p) => (p ?? '').trim())
          .filter(Boolean)
          .join(' ')
        return child.date_of_birth
          ? `${name} (DOB: ${formatReviewDateValue(child.date_of_birth)})`
          : name
      })))
    }
  }

  if (additionalNominees.length > 0) {
    sections.push(entries(
      isCollegePrep ? 'Parents & guardians' : 'Additional contacts',
      additionalNominees.map(additionalContactLine),
    ))
  }

  if (isCollegePrep) {
    for (const cpSection of collegePrepReviewSections(data)) {
      sections.push(fields(cpSection.title, cpSection.rows))
    }
  } else {
    sections.push(fields('Financial overview', reviewRows([
      ['estate_value', data.estate_value],
      ['asset_types', data.asset_types],
      ['Real estate', summarizeRealEstate(data)],
      ['Bank accounts', summarizeAssetTotals(data, 'bank_accounts')],
      ['Investments', summarizeAssetTotals(data, 'investment_accounts')],
      ['Retirement', summarizeAssetTotals(data, 'retirement_accounts')],
      ['Life insurance', summarizeAssetTotals(data, 'life_insurance')],
      ['Business interests', summarizeItemList(data, 'business_interests', 'business', 'businesses')],
      ['Liabilities', summarizeItemList(data, 'liabilities', 'liability', 'liabilities')],
    ])))

    sections.push(fields('Goals & wishes', reviewRows([
      ['why_choose_firm', objectives.why_choose_firm],
      ['why_now', objectives.why_now],
      ['make_things_easy', objectives.make_things_easy],
      ['planning_goals', data.planning_goals ?? data.goals],
      ['has_existing_plan', data.has_existing_plan],
      ['has_divorce_settlement', data.has_divorce_settlement],
      ['has_prior_gift_tax', data.has_prior_gift_tax],
      ['special_notes', data.special_notes ?? data.additional_notes],
    ])))
  }

  if (isCollegePrep) {
    sections.push(fiduciarySection('_fid_poa_client'))
    sections.push(fiduciarySection('_fid_hcp_client'))
  } else {
    sections.push(fiduciarySection('_fid_trustee_client'))
    sections.push(fiduciarySection('_fid_personal_rep_client'))
    sections.push(fiduciarySection('_fid_poa_client'))
    sections.push(fiduciarySection('_fid_hcp_client'))

    if (data.marital_status === 'married') {
      sections.push(fiduciarySection('_fid_personal_rep_spouse'))
      sections.push(fiduciarySection('_fid_poa_spouse'))
      sections.push(fiduciarySection('_fid_hcp_spouse'))
    }

    sections.push(fiduciarySection('_fid_guardian_client'))
    sections.push(fiduciarySection('_fid_excluded_guardian'))
  }

  // Dates print readably in the client's copy. The review screen shows them as
  // stored; this is the one place the download deliberately reads better than
  // the screen, so the parity test compares titles and labels, not values.
  return sections
    .filter((section): section is PortalReviewSection => section !== null)
    .map((section) =>
      section.kind === 'fields'
        ? {
            ...section,
            rows: section.rows.map(
              ([label, value]) => [label, formatReviewDateValue(value)] as [string, string],
            ),
          }
        : section,
    )
}
