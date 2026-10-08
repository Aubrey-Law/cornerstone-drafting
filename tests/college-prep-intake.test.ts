import { describe, expect, it } from 'vitest'

import { COLLEGE_PREP_STEPS } from '@/lib/collegePrepSections'
import { collegePrepReviewSections } from '@/lib/collegePrepReview'
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_META } from '@/lib/email/categories'
import { emailTemplateVariables } from '@/lib/email/templateVariables'
import {
  COLLEGE_PREP_INTAKE_INVITE,
  ESTATE_INTAKE_INVITE,
} from '@/lib/email/intakeInviteBodies'
import {
  getActiveSteps,
  getRequiredSteps,
  getStepById,
  getStepErrors,
  getStepIssues,
  getSubmissionErrors,
  isReadyToReview,
  type IntakeRow,
} from '@/lib/intakeSections'
import { getIntakeReadinessFlags } from '@/lib/intakeReadiness'
import { unpackInitialIntakeData } from '@/lib/intake/unpackInitialData'
import { getIntakeTrack, normalizeIntakeTrack } from '@/lib/intakeTrack'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'

const COLLEGE_TRACK = { intake_track: 'college_prep' } as const

/** A student row that clears every blocking error on the college-prep track. */
function completeCollegePrepIntake(overrides: IntakeRow = {}): IntakeRow {
  return {
    ...COLLEGE_TRACK,
    first_name: 'Rowan',
    last_name: 'Delgado',
    email: 'rowan@example.com',
    phone: '(617) 555-0142',
    street_address: '12 Elm Street',
    city: 'Newton',
    state: 'MA',
    zip: '02458',
    county: 'Middlesex',
    date_of_birth: '2007-04-02',
    college_school_name: 'Northeastern University',
    college_school_city: 'Boston',
    college_school_state: 'MA',
    college_move_in_date: '2026-08-28',
    college_ferpa_release: true,
    college_ferpa_records: ['grades', 'billing'],
    _additional_contacts: [
      { id: '1', first_name: 'Alma', last_name: 'Delgado', relationship: 'Mother', phone: '(617) 555-0143' },
    ],
    _fid_poa_client: [{ first_name: 'Alma', last_name: 'Delgado', priority: 1 }],
    _fid_hcp_client: [{ first_name: 'Alma', last_name: 'Delgado', priority: 1 }],
    college_hipaa_recipients: [{ id: 'r1', name: 'Alma Delgado', relationship: 'Mother' }],
    college_dpoa_effective: 'immediately',
    college_dpoa_powers: ['banking', 'tuition'],
    college_hipaa_scope: 'all',
    college_hipaa_expiration: 'none',
    college_living_will_include: 'yes',
    college_life_support: 'comfort_only',
    college_organ_donation: 'any',
    ...overrides,
  }
}

describe('intake track resolution', () => {
  it('keeps contact-only college submission and validation isolated from estate rules', () => {
    const data = { ...COLLEGE_TRACK, first_name: 'Rowan', last_name: 'Delgado', email: 'rowan@example.com', phone: '(617) 555-0142' }
    expect(getSubmissionErrors(data)).toEqual([])
    expect(isReadyToReview(data)).toBe(true)
    expect(getRequiredSteps(data).map(({ id }) => id)).toEqual(['cp_student', 'cp_school', 'cp_parents', 'cp_agents', 'cp_dpoa', 'cp_hipaa', 'cp_living_will'])
    expect(getStepErrors('cp_living_will', data).map(({ message }) => message)).toEqual(['Choose whether to include a living will.'])
  })
  it('defaults to the estate questionnaire', () => {
    expect(getIntakeTrack({})).toBe('estate')
    expect(getIntakeTrack({ intake_track: 'nonsense' })).toBe('estate')
    expect(normalizeIntakeTrack('nonsense')).toBeNull()
  })

  it('serves the college-prep steps only for that track', () => {
    const estateIds = getActiveSteps({}).map((step) => step.id)
    const collegeIds = getActiveSteps({ ...COLLEGE_TRACK }).map((step) => step.id)

    expect(estateIds).toContain('estate')
    expect(estateIds).not.toContain('cp_student')
    expect(collegeIds).toEqual(COLLEGE_PREP_STEPS.map((step) => step.id))
    // The estate track's asset, spouse, and guardian questions never appear.
    expect(collegeIds).not.toContain('estate')
    expect(collegeIds).not.toContain('spouse')
    expect(collegeIds).not.toContain('guardian')
  })

  it('resolves college-prep steps by id without a row', () => {
    expect(getStepById('cp_hipaa')?.title).toBe('HIPAA Authorization')
    expect(getStepById('personal')?.title).toBe('Personal Information')
  })

  it('excludes optional sections from the required set', () => {
    const requiredIds = getRequiredSteps({ ...COLLEGE_TRACK }).map((step) => step.id)
    expect(requiredIds).not.toContain('cp_healthcare')
    expect(requiredIds).not.toContain('cp_other')
    expect(requiredIds).not.toContain('review')
    expect(requiredIds).toContain('cp_agents')
  })
})

describe('cp_student validation', () => {
  it('requires the student identity fields the documents recite', () => {
    const messages = getStepErrors('cp_student', { ...COLLEGE_TRACK }).map((issue) => issue.message)
    expect(messages).toContain("Enter the student's first name.")
    expect(messages).toContain("Enter the student's cell phone number.")
    expect(messages).toContain('Select the Massachusetts county of the permanent address.')
  })

  it('warns — but does not block — when the student is still under 18', () => {
    const nextYear = new Date()
    nextYear.setFullYear(nextYear.getFullYear() - 17)
    const data = completeCollegePrepIntake({ date_of_birth: nextYear.toISOString().slice(0, 10) })

    const issues = getStepIssues('cp_student', data)
    const minorIssue = issues.find((issue) => issue.message.includes('under 18'))
    expect(minorIssue?.severity).toBe('warning')
    expect(getStepErrors('cp_student', data)).toEqual([])
  })
})

describe('cp_school validation', () => {
  it('requires a FERPA answer and its record list', () => {
    const base = completeCollegePrepIntake()
    expect(getStepErrors('cp_school', { ...base, college_ferpa_release: undefined })
      .map((issue) => issue.message))
      .toContain('Answer whether the student wants a FERPA release for school records.')

    expect(getStepErrors('cp_school', { ...base, college_ferpa_records: [] })
      .map((issue) => issue.message))
      .toContain('Select which school records the FERPA release should cover.')
  })

  it('accepts declining the FERPA release without a record list', () => {
    const data = completeCollegePrepIntake({ college_ferpa_release: false, college_ferpa_records: [] })
    expect(getStepErrors('cp_school', data)).toEqual([])
  })
})

describe('cp_agents validation', () => {
  it('nudges rather than blocks when no agents are named', () => {
    const data = completeCollegePrepIntake({
      _fid_poa_client: [],
      _fid_hcp_client: [],
      college_hipaa_recipients: [],
    })

    const issues = getStepIssues('cp_agents', data)
    expect(issues).toHaveLength(3)
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
    expect(getStepErrors('cp_agents', data)).toEqual([])
  })

  it.each(['discuss_with_attorney', 'not_provided_yet'])(
    'clears the section when the client chooses %s',
    (choice) => {
      const data = completeCollegePrepIntake({
        _fid_poa_client: [],
        _fid_hcp_client: [],
        college_hipaa_recipients: [],
        _review_choices: { cp_agents: choice },
      })

      expect(getStepIssues('cp_agents', data)).toEqual([])
      expect(getStepById('cp_agents')?.isComplete(data)).toBe(true)
    },
  )
})

describe('cp_hipaa validation', () => {
  it('requires an expiration because the authorization has to state one', () => {
    const data = completeCollegePrepIntake({ college_hipaa_expiration: undefined })
    expect(getStepErrors('cp_hipaa', data).map((issue) => issue.message))
      .toContain('Choose when the HIPAA authorization expires.')
  })

  it('requires a date when the client picks a dated expiration', () => {
    const data = completeCollegePrepIntake({ college_hipaa_expiration: 'date' })
    expect(getStepErrors('cp_hipaa', data).map((issue) => issue.message))
      .toContain('Enter the date the HIPAA authorization should expire.')

    const dated = completeCollegePrepIntake({
      college_hipaa_expiration: 'date',
      college_hipaa_expiration_date: '2030-05-15',
    })
    expect(getStepErrors('cp_hipaa', dated)).toEqual([])
  })

  it('requires at least one carve-out when the scope excludes categories', () => {
    const data = completeCollegePrepIntake({ college_hipaa_scope: 'all_except' })
    expect(getStepErrors('cp_hipaa', data).map((issue) => issue.message))
      .toContain('Select at least one category to withhold, or choose “All health information”.')
  })
})

describe('cp_living_will validation', () => {
  it('asks nothing further when the student declines a living will', () => {
    const data = completeCollegePrepIntake({
      college_living_will_include: 'no',
      college_life_support: undefined,
      college_organ_donation: undefined,
    })
    expect(getStepIssues('cp_living_will', data)).toEqual([])
  })

  it('requires the life-support instruction once a living will is included', () => {
    const data = completeCollegePrepIntake({ college_life_support: undefined })
    expect(getStepErrors('cp_living_will', data).map((issue) => issue.message))
      .toContain('Choose the student’s instruction about life-sustaining treatment.')
  })
})

describe('college-prep submission gating', () => {
  it('accepts a complete college-prep intake', () => {
    const data = completeCollegePrepIntake()
    expect(getSubmissionErrors(data)).toEqual([])
    expect(isReadyToReview(data)).toBe(true)
  })

  it('never validates a college-prep intake against estate questions', () => {
    const messages = getSubmissionErrors({ ...COLLEGE_TRACK }).map((issue) => issue.message)
    expect(messages.some((message) => message.includes('estate value'))).toBe(false)
    expect(messages.some((message) => message.includes('marital status'))).toBe(false)
  })

  it('lets the student submit with a college-prep answer still missing', () => {
    const data = completeCollegePrepIntake({ college_dpoa_effective: undefined })
    expect(getStepErrors('cp_dpoa', data).length).toBeGreaterThan(0)
    expect(isReadyToReview(data)).toBe(true)
  })

  it('blocks submission only on the student contact information', () => {
    const data = completeCollegePrepIntake({ email: '', phone: '' })
    expect(isReadyToReview(data)).toBe(false)
    expect(getSubmissionErrors(data).map((issue) => issue.sectionId)).toEqual(['cp_student', 'cp_student'])
  })
})

describe('college-prep answers stored as a JSONB blob', () => {
  it('validates against the nested row the server reads, not just the wizard shape', () => {
    const { college_hipaa_scope: _scope, college_hipaa_expiration: _expiration, ...rest } =
      completeCollegePrepIntake()
    const serverRow: IntakeRow = {
      ...rest,
      college_prep_details: { hipaa_scope: 'all', hipaa_expiration: 'none' },
    }

    expect(getStepErrors('cp_hipaa', serverRow)).toEqual([])
  })

  it('flattens college_prep_details back into wizard fields on load', () => {
    const unpacked = unpackInitialIntakeData({
      intake_track: 'college_prep',
      college_prep_details: { school_name: 'Tufts', dpoa_powers: ['banking'] },
    })

    expect(unpacked.college_school_name).toBe('Tufts')
    expect(unpacked.college_dpoa_powers).toEqual(['banking'])
    expect(unpacked.college_prep_details).toBeUndefined()
  })
})

describe('attorney readiness flags', () => {
  it('never asks a college-prep intake for a trustee or personal representative', () => {
    const keys = getIntakeReadinessFlags(completeCollegePrepIntake({
      _fid_poa_client: [],
      _fid_hcp_client: [],
    })).map((flag) => flag.key)

    expect(keys).toContain('client_poa_missing')
    expect(keys).toContain('client_hcp_missing')
    expect(keys).not.toContain('client_trustee_missing')
    expect(keys).not.toContain('client_personal_rep_missing')
    expect(keys).not.toContain('guardian_missing')
  })

  it('flags a student who cannot sign yet', () => {
    const seventeen = new Date()
    seventeen.setFullYear(seventeen.getFullYear() - 17)
    const flags = getIntakeReadinessFlags(
      completeCollegePrepIntake({ date_of_birth: seventeen.toISOString().slice(0, 10) }),
    )

    const minorFlag = flags.find((flag) => flag.key === 'student_under_eighteen')
    expect(minorFlag?.resolutionKind).toBe('attorney_judgment')
  })

  it('reads the stored blob when flagging a missing DPOA effective date', () => {
    const { college_dpoa_effective: _effective, ...rest } = completeCollegePrepIntake()
    const withBlob: IntakeRow = { ...rest, college_prep_details: { dpoa_effective: 'immediately' } }

    expect(getIntakeReadinessFlags(withBlob).map((flag) => flag.key))
      .not.toContain('dpoa_effective_missing')
    expect(getIntakeReadinessFlags(rest as IntakeRow).map((flag) => flag.key))
      .toContain('dpoa_effective_missing')
  })

  it('leaves the estate rules untouched', () => {
    const keys = getIntakeReadinessFlags({ marital_status: 'single' }).map((flag) => flag.key)
    expect(keys).toContain('client_trustee_missing')
  })
})

describe('lead intake progress', () => {
  it('reports college-prep segments instead of assets and guardians', () => {
    const labels = getLeadIntakeProgress(completeCollegePrepIntake()).map((segment) => segment.label)
    expect(labels).toEqual(['Student', 'School', 'Parents', 'Agents', 'Documents', 'Review'])
  })

  it('leaves the estate rail unchanged', () => {
    const labels = getLeadIntakeProgress({}).map((segment) => segment.label)
    expect(labels).toContain('Assets')
    expect(labels).toContain('Real estate')
  })
})

describe('college-prep review summary', () => {
  it('labels stored codes and drops empty sections', () => {
    const sections = collegePrepReviewSections(completeCollegePrepIntake())
    const byTitle = Object.fromEntries(sections.map((section) => [section.title, section.rows]))

    expect(byTitle['Power of attorney — scope']).toContainEqual([
      'Takes effect',
      'Immediately upon signing',
    ])
    expect(byTitle['Power of attorney — scope']).toContainEqual([
      'Powers granted',
      'Banking and bank accounts, Tuition, bursar, and student accounts',
    ])
    // Nothing was entered for the health care proxy limits or instructions.
    expect(byTitle['Health care proxy']).toBeUndefined()
  })
})

describe('college-prep timing and invitation', () => {
  it('estimates about 20 minutes for the whole questionnaire', () => {
    const total = COLLEGE_PREP_STEPS.reduce((sum, step) => sum + step.timeEstimate, 0)
    expect(total).toBe(20)
  })

  it('gives the parent-facing invitation its own editable category', () => {
    // A variant subject line on `intake_invite` would have shared the estate
    // stored template, which sendEmail prefers over the inline body.
    expect(EMAIL_CATEGORIES).toContain('intake_invite_college_prep')
    expect(EMAIL_CATEGORY_META.intake_invite_college_prep.recipient).toBe('client')
  })

  it('explains what changes at 18 and links the questionnaire', () => {
    const { subject, html } = COLLEGE_PREP_INTAKE_INVITE
    expect(subject).toBe('College Preparation Plan — intake form inside')
    // snake_case is the canonical tag form — the builder documents it, the
    // variable picker offers it, and every send path resolves it.
    for (const marker of ['{{first_name}}', '{{intake_link}}', 'HIPAA', 'FERPA', 'about 20 minutes']) {
      expect(html).toContain(marker)
    }
    expect(html).not.toContain('{{firstName}}')
    // The firm signature is appended at send time; repeating it here doubled it.
    expect(html).not.toContain('{{attorneyShortName}}')
    expect(html).not.toContain('{{firmName}}')
    // The estate invitation must not pick up the parent-facing copy.
    expect(ESTATE_INTAKE_INVITE.html).not.toContain('FERPA')
  })

  it('spells every tag in both invitations with an offered variable', () => {
    const offered = new Set(
      emailTemplateVariables('intake_invite').map((option) => option.key),
    )
    for (const invite of [ESTATE_INTAKE_INVITE, COLLEGE_PREP_INTAKE_INVITE]) {
      const tags = [...`${invite.subject} ${invite.html}`.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)]
        .map((match) => match[1])
      expect(tags.length).toBeGreaterThan(0)
      for (const tag of tags) {
        // A tag outside the picker is one an author cannot discover, and one
        // nothing guarantees the send path resolves.
        expect(offered.has(tag)).toBe(true)
      }
    }
  })
})
