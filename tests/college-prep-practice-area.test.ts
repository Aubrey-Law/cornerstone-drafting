import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  intakeTrackForPracticeArea,
  reconcileMatterIntakeTrack,
} from '@/lib/intake/reconcileMatterIntakeTrack'
import {
  PRACTICE_AREA_OPTIONS,
  isCollegePrepPracticeArea,
  normalizePracticeArea,
  parsePracticeArea,
  practiceAreaLabel,
  practiceAreaMatterCode,
} from '@/lib/practiceArea'
import {
  planTrackForPracticeArea,
  reconcilePlanTrackDecisions,
} from '@/lib/designSheet/reconcilePlanTrack'
import { getCollegePrepDesign, getDesignPlanTrack } from '@/lib/collegePrepDesign'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { isEstatePlanningPracticeArea } from '@/lib/draftPayload/helpers'
import { formatMatterNumberWithClient } from '@/lib/matterNumber'
import type { DesignSheet } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

const COLLEGE_PREP_DETAILS = {
  school_name: 'Northeastern University',
  school_city: 'Boston',
  school_state: 'MA',
  ferpa_release: true,
  ferpa_records: ['grades'],
  dpoa_effective: 'immediately',
  dpoa_powers: ['banking'],
  hipaa_scope: 'all',
  hipaa_expiration: 'none',
  living_will_include: 'yes',
  life_support: 'comfort_only',
}

const collegePrepIntake = {
  intake_track: 'college_prep',
  college_prep_details: COLLEGE_PREP_DETAILS,
} as unknown as IntakeSnapshot

/** An estate sheet the attorney has already worked. */
function estateSheet(): DesignSheet {
  return {
    client_name: 'Rowan Delgado',
    matter_type: 'individual',
    marital_status: 'single',
    plan_type: 'pour_over',
    children: null,
    decisions: {
      document_inclusions: { trust: true, will: true, dpoa: true, healthcare: true },
      estate_plan_design: { signing_type: 'attorney_supervised' },
    },
  } as unknown as DesignSheet
}

describe('College Preparation Plan practice area', () => {
  it('is a practice area the firm can pick', () => {
    expect(PRACTICE_AREA_OPTIONS.map(option => option.value)).toEqual(['EP', 'EP-LP', 'CP', 'Probate'])
    expect(practiceAreaLabel('CP')).toBe('College Preparation Plan')
    expect(isCollegePrepPracticeArea('CP')).toBe(true)
    expect(isCollegePrepPracticeArea('EP')).toBe(false)
  })

  it('parses the code and the spellings a human or an import might send', () => {
    expect(parsePracticeArea('CP')).toBe('CP')
    expect(parsePracticeArea('cp')).toBe('CP')
    expect(parsePracticeArea('College Preparation Plan')).toBe('CP')
    expect(parsePracticeArea('College Prep')).toBe('CP')
    expect(parsePracticeArea('Something Else')).toBeNull()
    // Unknown values still fall back to EP rather than throwing.
    expect(normalizePracticeArea('Something Else')).toBe('EP')
  })

  it('numbers new matters in its own sequence', () => {
    expect(practiceAreaMatterCode('CP')).toBe('CP')
    expect(formatMatterNumberWithClient(2026, 'CP', 'delgado', 1)).toContain('CP')
    // The other areas are untouched.
    expect(practiceAreaMatterCode('EP')).toBe('EP')
    expect(practiceAreaMatterCode('EP-LP')).toBe('EPLP')
    expect(practiceAreaMatterCode('Probate')).toBe('PR')
  })

  it('still drives draft packages — leaving it out would generate nothing', () => {
    expect(isEstatePlanningPracticeArea('CP')).toBe(true)
    expect(isEstatePlanningPracticeArea('EP')).toBe(true)
    expect(isEstatePlanningPracticeArea('Probate')).toBe(false)
  })
})

describe('design sheet follows the practice area', () => {
  it('maps each practice area to a plan track', () => {
    expect(planTrackForPracticeArea('CP')).toBe('college_prep')
    expect(planTrackForPracticeArea('EP')).toBe('estate')
    expect(planTrackForPracticeArea('EP-LP')).toBe('estate')
    expect(planTrackForPracticeArea(null)).toBe('estate')
  })

  it('moves an estate sheet onto the student plan, document set included', () => {
    const { decisions } = reconcilePlanTrackDecisions({
      sheet: estateSheet(),
      practiceArea: 'CP',
      intake: collegePrepIntake,
    })

    expect(decisions).not.toBeNull()
    const switched = { ...estateSheet(), decisions } as DesignSheet
    expect(getDesignPlanTrack(switched)).toBe('college_prep')
    // The stored `trust: true` must not survive the move.
    expect(getDocumentInclusions(switched)).toMatchObject({ trust: false, will: false, dpoa: true })
    expect(getCollegePrepDesign(switched).school_name).toBe('Northeastern University')
  })

  it('moves a college sheet back when the practice area says estate', () => {
    const { decisions: toCollege } = reconcilePlanTrackDecisions({
      sheet: estateSheet(),
      practiceArea: 'CP',
      intake: collegePrepIntake,
    })
    const student = { ...estateSheet(), decisions: toCollege } as DesignSheet

    const { decisions: back } = reconcilePlanTrackDecisions({
      sheet: student,
      practiceArea: 'EP',
    })
    const estate = { ...student, decisions: back } as DesignSheet

    expect(getDesignPlanTrack(estate)).toBe('estate')
    expect(getDocumentInclusions(estate)).toMatchObject({ trust: true, will: true })
    // The answers stay, so a correction back to CP is not re-entry.
    expect(getCollegePrepDesign(estate).school_name).toBe('Northeastern University')
  })

  it('writes nothing when the sheet already agrees', () => {
    const { decisions } = reconcilePlanTrackDecisions({
      sheet: estateSheet(),
      practiceArea: 'EP',
    })

    expect(decisions).toBeNull()
  })

  it('leaves the section empty rather than wrong when the intake is an estate one', () => {
    const { decisions } = reconcilePlanTrackDecisions({
      sheet: estateSheet(),
      practiceArea: 'CP',
      intake: { intake_track: 'estate' } as unknown as IntakeSnapshot,
    })
    const switched = { ...estateSheet(), decisions } as DesignSheet

    expect(getDesignPlanTrack(switched)).toBe('college_prep')
    expect(getCollegePrepDesign(switched).school_name).toBeNull()
  })

  it('handles a matter with no design sheet yet', () => {
    expect(reconcilePlanTrackDecisions({ sheet: null, practiceArea: 'CP' })).toEqual({
      track: 'college_prep',
      decisions: null,
    })
  })
})

/**
 * A matter reclassified as a College Preparation Plan has to change what the
 * intake asks, not just what drafts — otherwise the attorney intake sheet keeps
 * showing assets, spouse and trust and hides the student's own questions.
 */
function intakeTrackHarness(options: { intakeId?: string | null; track?: string } = {}) {
  const updates: Array<Record<string, unknown>> = []
  const admin = {
    from: (table: string) => {
      if (table === 'matters') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.intakeId === null
                  ? null
                  : { client_intake_id: options.intakeId ?? 'intake-1' },
              }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'intake-1', intake_track: options.track ?? 'estate' },
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(payload)
            return { error: null }
          },
        }),
      }
    },
  }
  return { admin: admin as unknown as Parameters<typeof reconcileMatterIntakeTrack>[0], updates }
}

describe('intake questionnaire follows the practice area', () => {
  it('maps each practice area to its questionnaire', () => {
    expect(intakeTrackForPracticeArea('CP')).toBe('college_prep')
    expect(intakeTrackForPracticeArea('College Preparation Plan')).toBe('college_prep')
    expect(intakeTrackForPracticeArea('EP')).toBe('estate')
    expect(intakeTrackForPracticeArea('EP-LP')).toBe('estate')
    expect(intakeTrackForPracticeArea('Probate')).toBe('estate')
    expect(intakeTrackForPracticeArea(null)).toBe('estate')
  })

  it('moves the intake to the student questionnaire', async () => {
    const { admin, updates } = intakeTrackHarness({ track: 'estate' })

    expect(await reconcileMatterIntakeTrack(admin, 'matter-1', 'CP')).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ intake_track: 'college_prep' })
  })

  it('moves the intake back to the estate questionnaire', async () => {
    const { admin, updates } = intakeTrackHarness({ track: 'college_prep' })

    expect(await reconcileMatterIntakeTrack(admin, 'matter-1', 'EP')).toBe(true)
    expect(updates[0]).toMatchObject({ intake_track: 'estate' })
  })

  it('writes nothing when the intake already agrees', async () => {
    const { admin, updates } = intakeTrackHarness({ track: 'college_prep' })

    expect(await reconcileMatterIntakeTrack(admin, 'matter-1', 'CP')).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('handles a matter with no intake linked', async () => {
    const { admin, updates } = intakeTrackHarness({ intakeId: null })

    expect(await reconcileMatterIntakeTrack(admin, 'matter-1', 'CP')).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('leaves a fresh college section to fill in when the intake collected no answers', () => {
    // Reclassifying flips the questionnaire first, so the design-sheet
    // reconcile then adopts answers from an intake that has none. The section
    // has to come up empty and valid rather than throwing or inventing values.
    const { decisions } = reconcilePlanTrackDecisions({
      sheet: estateSheet(),
      practiceArea: 'CP',
      intake: {
        intake_track: 'college_prep',
        college_prep_details: null,
      } as unknown as IntakeSnapshot,
    })
    const switched = { ...estateSheet(), decisions } as DesignSheet

    expect(getDesignPlanTrack(switched)).toBe('college_prep')
    expect(getCollegePrepDesign(switched).school_name).toBeNull()
    expect(getCollegePrepDesign(switched).living_will_include).toBeNull()
  })

  it('sets the questionnaire when a matter is created on the college track', () => {
    // create_matter_with_client writes the practice area onto the intake but
    // not the questionnaire, so the row takes the 'estate' column default. The
    // design-sheet seed reads the same field, so the reconcile has to land
    // before it or a new College Preparation Plan seeds an estate sheet too.
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matters/create/route.ts'),
      'utf8',
    )
    const trackAt = route.indexOf('reconcileMatterIntakeTrack(admin, row.matter_id, practiceArea)')
    const seedAt = route.indexOf('ensureDesignSheetSeededFromIntake(row.matter_id)')

    expect(trackAt).toBeGreaterThan(-1)
    expect(seedAt).toBeGreaterThan(trackAt)
  })

  it('reads the attorney intake sheet as college prep from the practice area too', () => {
    // Matters created before the questionnaire followed the practice area keep
    // the 'estate' default, so the sheet must not trust the track alone.
    const sheet = fs.readFileSync(
      path.join(process.cwd(), 'components/AdminIntakeSheet.tsx'),
      'utf8',
    )

    expect(sheet).toContain(
      "intakeTrack === 'college_prep' || isCollegePrepPracticeArea(practiceArea)",
    )
  })

  it('recognises the practice area label the intake sheet is handed', () => {
    // The sheet receives practiceAreaLabel(...), not the stored code.
    expect(isCollegePrepPracticeArea('College Preparation Plan')).toBe(true)
    expect(isCollegePrepPracticeArea('Estate Planning')).toBe(false)
    expect(isCollegePrepPracticeArea('')).toBe(false)
  })

  it('reclassifies the questionnaire before the design sheet adopts the answers', () => {
    // Order matters: reconcilePlanTrackDecisions only adopts the student's
    // questionnaire answers when the intake is already on the college track.
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/matter-details/route.ts'),
      'utf8',
    )
    const intakeAt = route.indexOf('reconcileMatterIntakeTrack(admin, matterId, normalizedValue)')
    const sheetAt = route.indexOf('reconcileDesignSheetPlanTrack(admin, matterId, normalizedValue)')

    expect(intakeAt).toBeGreaterThan(-1)
    expect(sheetAt).toBeGreaterThan(intakeAt)
  })
})
