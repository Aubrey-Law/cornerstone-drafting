import { describe, expect, it } from 'vitest'

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
