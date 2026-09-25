// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateRule } from '@aubrey-law/citations/playbookBuilder/extractRules'

vi.mock('@/app/playbooks/actions', () => ({ publishPlaybook: vi.fn() }))

import { PlaybookBuilder, rowsFromCandidates } from '@/app/playbooks/PlaybookBuilder'

const candidate = (over: Partial<CandidateRule>): CandidateRule => ({
  id: 'w0-0',
  statement: 'Our trustees serve without bond.',
  risk: 'medium',
  topic: 'Bond',
  preferredLanguage: null,
  citation: null,
  citationRefusal: 'not_found',
  attemptedQuote: 'The trustee is bonded.',
  conditions: [],
  ...over,
})

describe('rowsFromCandidates', () => {
  it('ticks only candidates whose quote was verified', () => {
    const rows = rowsFromCandidates([
      candidate({}),
      candidate({
        id: 'w0-1',
        citationRefusal: null,
        attemptedQuote: null,
        citation: {
          blockIndex: 4,
          charStart: 0,
          charEnd: 10,
          page: null,
          bbox: null,
          quote: 'without bond',
          verification: 'verified',
        },
      }),
    ])
    expect(rows.map((row) => row.included)).toEqual([false, true])
    expect(rows[0].source).toMatchObject({ verified: false, quote: 'The trustee is bonded.' })
    expect(rows[1].source).toMatchObject({ verified: true, blockIndex: 4 })
  })
})

describe('PlaybookBuilder', () => {
  it('loads a published playbook as the starting rules and locks its id', () => {
    render(
      <PlaybookBuilder
        playbooks={[
          {
            slug: 'ma-trust-firm-qa',
            title: 'Massachusetts revocable trust — firm quality review',
            version: 1,
            rules: [
              { statement: 'Rule one.', risk: 'high', preferredLanguage: null, conditions: [] },
              {
                statement: 'Rule two.',
                risk: 'blocker',
                preferredLanguage: 'wording',
                conditions: [{ fact: 'has_minor_children', test: 'is', value: true }],
              },
            ],
          },
        ]}
      />,
    )
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 'ma-trust-firm-qa' } })
    expect(screen.getAllByTestId('builder-rule')).toHaveLength(2)
    expect(screen.getByLabelText('Playbook id')).toBeDisabled()
    expect(screen.getByText(/Publishing creates version 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publish 2 rules' })).toBeEnabled()
    // The published rule's condition loads as a chip, and a new one can be added.
    const [first, second] = screen.getAllByTestId('rule-conditions')
    expect(first).toHaveTextContent('to every matter')
    expect(second).toHaveTextContent('has minor children')
    fireEvent.change(within(first).getByLabelText('Add a condition'), { target: { value: 'married' } })
    expect(first).toHaveTextContent('only when')
    expect(first).toHaveTextContent('client is married')
  })
})
