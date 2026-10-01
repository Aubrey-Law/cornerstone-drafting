// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OperationalBrief } from '@/components/lifecycle/OperationalBrief'

describe('operational lifecycle brief', () => {
  it('separates facts, ownership, conflicts and the next-stage blockers', () => {
    render(<OperationalBrief brief={{
      known: ['Intake questionnaire sent'],
      missing: ['County'],
      clientFollowUp: ['County'],
      attorneyDecision: ['Trust design'],
      conflicts: ['Beneficiary instruction conflicts with intake'],
      nextStageLabel: 'Drafting',
      nextStageBlockers: ['Intake and design conflicts resolved'],
      meetingPreparation: ['Clarify: County.'],
    }} />)

    for (const label of [
      'Known facts', 'Missing facts', 'Client follow-up needed', 'Attorney decisions needed',
      'Conflicts requiring review', 'Next lifecycle stage',
    ]) {
      expect(screen.getByRole('region', { name: label })).toBeTruthy()
    }
    expect(screen.getByText('Drafting')).toBeTruthy()
    expect(screen.getByText('Meeting preparation')).toBeTruthy()
  })
})
