// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// A bundled compilation failure must not prevent importing or reviewing the
// rollback questionnaire. The real legacy selectors and checklist still run.
vi.mock('@/lib/intake/forms/definitions', () => {
  throw new Error('Compiled questionnaire is unavailable')
})
vi.mock('@/lib/intake/forms/evaluator', () => {
  throw new Error('Compiled evaluation is unavailable')
})

import { ReviewModal } from '@/components/intake/LegacyGuidedInterview'
import { StepReview } from '@/components/intake/IntakeWizard'

afterEach(cleanup)
const NOOP = () => {}

describe('legacy review survives unavailable compiled forms', () => {
  it.each([
    { track: 'estate', data: { marital_status: 'married' }, wanted: "Enter your spouse's first name.", absent: 'Choose when the power of attorney takes effect.' },
    { track: 'college_prep', data: { intake_track: 'college_prep' }, wanted: 'Choose when the power of attorney takes effect.', absent: "Enter your spouse's first name." },
  ])('renders the frozen $track modal checklist', ({ data, wanted, absent }) => {
    render(<ReviewModal data={data} intakeId="" isAttorney={false} selectedDocKeys={[]} legalFlags={[]} readinessFlags={[]} submitting={false} canSubmit onEdit={NOOP} onClose={NOOP} onSubmit={NOOP} />)
    expect(screen.getByText(wanted)).toBeTruthy()
    expect(screen.queryByText(absent)).toBeNull()
    expect(screen.getByRole('button', { name: /Submit/ })).toBeTruthy()
  })

  it('keeps the legacy step composition independent of compiled module initialization', () => {
    render(<StepReview data={{ intake_track: 'college_prep' }} />)
    expect(screen.getByText("Enter the student's first name.")).toBeTruthy()
    expect(screen.queryByText('Select an estimated total estate value.')).toBeNull()
  })
})
