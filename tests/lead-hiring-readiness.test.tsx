// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LeadHiringReadiness } from '@/components/leads/LeadHiringReadiness'
import { evaluateLeadRequirements } from '@/lib/lifecycle/lead'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

afterEach(cleanup)

it('shows existing missing requirements and routes review to the selected requirement', () => {
  const requirements = evaluateLeadRequirements({ practice_area: 'EP', lead_status: 'lead' } as LeadDetailRecord, null)
    .filter(item => !item.satisfied && item.blocksStage)
  const onResolve = vi.fn()
  render(<LeadHiringReadiness requirements={requirements} busy={false} onResolve={onResolve} />)
  expect(screen.getByRole('region', { name: 'Before hiring' })).toBeTruthy()
  expect(screen.getAllByRole('button').filter(button => !button.closest('details'))).toHaveLength(3)
  const disclosure = screen.getByText(`Show ${requirements.length - 3} more`).closest('details')!
  expect(disclosure.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: `Review ${requirements[0].label}` }))
  expect(onResolve).toHaveBeenCalledWith(requirements[0])
  fireEvent.click(screen.getByText(`Show ${requirements.length - 3} more`))
  expect(disclosure.open).toBe(true)
  expect(screen.getAllByRole('button')).toHaveLength(requirements.length)
})

it('does not invent blockers when none are recorded', () => {
  render(<LeadHiringReadiness requirements={[]} busy={false} onResolve={vi.fn()} />)
  expect(screen.queryByRole('region')).toBeNull()
})
