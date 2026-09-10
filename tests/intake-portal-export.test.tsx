// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Packer } from 'docx'
import PizZip from 'pizzip'
import {
  buildPortalReviewSections,
  type PortalReviewSection,
} from '@/lib/intake/portalReviewSections'
import { IntakeQuestionnaireReview } from '@/components/intake/IntakeQuestionnaireReview'
import { buildIntakeWordDocument, type IntakeExportSection } from '@/lib/intake/wordExport'

afterEach(cleanup)

/** An estate-track intake with something answered in every review section. */
function estateIntake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'intake-1',
    intake_track: 'estate',
    referral_source: 'referral',
    referral_name: 'Dr. Alice Chen',
    legal_insurance_plan: 'MetLife',
    legal_insurance_member_id: 'M-12345',
    first_name: 'Jane',
    last_name: 'Smith',
    preferred_name: 'Janie',
    date_of_birth: '1972-04-08',
    email: 'jane@example.com',
    phone: '6175550100',
    street_address: '12 Elm St',
    city: 'Newton',
    state: 'MA',
    zip: '02458',
    county: 'Middlesex',
    is_us_citizen: true,
    marital_status: 'married',
    has_children: true,
    has_minor_children: true,
    estate_value: '500k_2m',
    planning_objectives: {
      why_choose_firm: 'Recommended by my CPA',
      why_now: 'New grandchild',
      make_things_easy: 'Keep it out of court',
    },
    planning_goals: 'Avoid probate',
    special_notes: 'Cabin in Vermont is jointly held',
    _spouse: {
      first_name: 'Alex',
      last_name: 'Smith',
      date_of_birth: '1974-02-02',
      email: 'alex@example.com',
      phone: '6175550111',
    },
    _children: [
      { id: 'c1', first_name: 'Robin', last_name: 'Smith', date_of_birth: '2014-06-01' },
    ],
    _fid_trustee_client: [
      { first_name: 'Alex', last_name: 'Smith', relationship: 'Spouse', priority: 1 },
      { first_name: 'Pat', last_name: 'Jones', relationship: 'Sister', priority: 2 },
    ],
    ...overrides,
  }
}

function titles(sections: PortalReviewSection[]): string[] {
  return sections.map((section) => section.title)
}

function fieldRows(sections: PortalReviewSection[], title: string): [string, string][] {
  const section = sections.find((s) => s.title === title)
  return section?.kind === 'fields' ? section.rows : []
}

function valueOf(sections: PortalReviewSection[], title: string, label: string): string | undefined {
  return fieldRows(sections, title).find(([rowLabel]) => rowLabel === label)?.[1]
}

function entriesOf(sections: PortalReviewSection[], title: string): string[] {
  const section = sections.find((s) => s.title === title)
  return section?.kind === 'entries' ? section.entries : []
}

describe('portal review sections', () => {
  it('carries the questions the client answered, in the review\'s own wording', () => {
    const sections = buildPortalReviewSections(estateIntake())

    expect(titles(sections)).toEqual([
      'Getting Started',
      'Personal Information',
      'Family',
      'Spouse',
      'Children',
      'Financial overview',
      'Goals & wishes',
      'Successor trustee',
    ])

    // The portal-only questions the attorney form never asks.
    expect(valueOf(sections, 'Getting Started', 'Legal insurance plan')).toBe('MetLife')
    expect(valueOf(sections, 'Goals & wishes', 'Why Aubrey Law')).toBe('Recommended by my CPA')
    expect(valueOf(sections, 'Goals & wishes', 'Why planning now')).toBe('New grandchild')
    expect(valueOf(sections, 'Personal Information', 'Preferred name')).toBe('Janie')
  })

  it('drops sections the client left empty rather than printing blank headings', () => {
    const sections = buildPortalReviewSections({ id: 'x', intake_track: 'estate', first_name: 'Jane' })

    expect(titles(sections)).not.toContain('Getting Started')
    expect(titles(sections)).not.toContain('Spouse')
    expect(titles(sections)).not.toContain('Children')
    expect(titles(sections)).toContain('Personal Information')
  })

  it('lists fiduciaries by their standing, matching the on-screen labels', () => {
    const sections = buildPortalReviewSections(estateIntake())

    expect(entriesOf(sections, 'Successor trustee')).toEqual([
      'Primary: Alex Smith (Spouse)',
      'Alternate 1: Pat Jones (Sister)',
    ])
  })

  it('marks a co-agent rather than numbering them as alternates', () => {
    const sections = buildPortalReviewSections(estateIntake({
      _fid_trustee_client: [
        { first_name: 'Alex', last_name: 'Smith', relationship: '', priority: 1 },
        { first_name: 'Pat', last_name: 'Jones', relationship: '', priority: 2, is_coagent: true },
      ],
    }))

    expect(entriesOf(sections, 'Successor trustee')).toEqual([
      'Primary: Alex Smith',
      'Co-agent 2: Pat Jones',
    ])
  })

  it('composes an additional contact into one line with their details', () => {
    const sections = buildPortalReviewSections(estateIntake({
      _additional_contacts: [{
        id: 'a1',
        first_name: 'Sam',
        last_name: 'Reed',
        relationship: 'Nephew',
        street: '9 Oak Rd',
        city: 'Quincy',
        state: 'MA',
        zip: '02169',
        phone: '6175550122',
        email: 'sam@example.com',
      }],
    }))

    expect(entriesOf(sections, 'Additional contacts')).toEqual([
      'Sam Reed (Nephew) — 9 Oak Rd, Quincy, MA, 02169 · (617) 555-0122 · sam@example.com',
    ])
  })

  it('serves the College Preparation Plan its own sections, not the estate ones', () => {
    const sections = buildPortalReviewSections({
      id: 'cp',
      intake_track: 'college_prep',
      first_name: 'Robin',
      last_name: 'Smith',
      marital_status: 'married',
      referral_source: 'referral',
      _fid_hcp_client: [{ first_name: 'Dana', last_name: 'Lee', relationship: 'Parent', priority: 1 }],
    })

    expect(titles(sections)).toContain('Student Information')
    expect(titles(sections)).not.toContain('Personal Information')
    expect(titles(sections)).not.toContain('Financial overview')
    expect(titles(sections)).not.toContain('Goals & wishes')
    // A married marital_status must not smuggle in the spouse fiduciary blocks.
    expect(titles(sections)).not.toContain('Spouse')
    expect(entriesOf(sections, 'Health care proxy')).toEqual(['Primary: Dana Lee (Parent)'])
  })
})

describe('portal review export — parity with the screen', () => {
  it('exports the same sections and labels the review renders', () => {
    const data = estateIntake()
    // No intakeId: the upload summary and download button both need one, and
    // this assertion is about the answer sections themselves.
    render(<IntakeQuestionnaireReview data={data} />)

    const rendered = screen.getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent?.trim() ?? '')
      .filter((title) => title !== 'Submission checklist')

    expect(rendered).toEqual(titles(buildPortalReviewSections(data)))

    // And the field labels inside them line up too, so a renamed question on
    // screen cannot silently keep its old wording in the download.
    const renderedLabels = Array.from(document.querySelectorAll('dt'))
      .map((node) => node.textContent?.trim() ?? '')
    const builtLabels = buildPortalReviewSections(data)
      .flatMap((section) => (section.kind === 'fields' ? section.rows.map(([label]) => label) : []))
    expect(renderedLabels).toEqual(builtLabels)
  })
})

describe('portal review export — document', () => {
  it('packs the client answers into a Word file', async () => {
    const sections: IntakeExportSection[] = buildPortalReviewSections(estateIntake()).map(
      (section) =>
        section.kind === 'fields'
          ? { title: section.title, rows: section.rows.map(([label, value]) => ({ label, value })) }
          : { title: section.title, rows: [], lines: section.entries },
    )
    const document = buildIntakeWordDocument(sections, {
      clientName: 'Jane Smith',
      practiceArea: 'Estate Planning',
      intakeTrack: 'estate',
      status: null,
      exportedOn: '2026-09-10',
      documentTitle: 'Your Intake Answers',
    })
    const xml = new PizZip(await Packer.toBuffer(document)).file('word/document.xml')?.asText() ?? ''

    expect(xml).toContain('Your Intake Answers')
    expect(xml).toContain('MetLife')
    expect(xml).toContain('Recommended by my CPA')
    // List sections print one line per entry.
    expect(xml).toContain('Primary: Alex Smith (Spouse)')
    // The internal workflow status never reaches the client's copy.
    expect(xml).not.toContain('Status:')
  })
})

describe('portal review export — wiring', () => {
  it('authorizes the client route by ownership, never by the id in the path', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/intake/[intakeId]/export/route.ts'),
      'utf8',
    )

    expect(route).toContain('resolveIntakeUploadAccess(req, intakeId)')
    expect(route).toContain('buildPortalReviewSections')
    expect(route).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    // The client route must not reach for admin auth — it is not an admin route.
    expect(route).not.toContain('requireAdmin')
  })

  it('sends the portal caller\'s own credentials with the download', () => {
    const review = fs.readFileSync(
      path.join(process.cwd(), 'components/intake/IntakeQuestionnaireReview.tsx'),
      'utf8',
    )

    expect(review).toContain('Download a copy (Word)')
    expect(review).toContain('/api/intake/${intakeId}/export')
    expect(review).toContain("'X-Intake-Token': publicIntakeToken")
  })

  it('keeps the attorney export on the admin route', () => {
    const adminRoute = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/intake/[intakeId]/export/route.ts'),
      'utf8',
    )
    expect(adminRoute).toContain('requireAdmin(req)')
  })
})
