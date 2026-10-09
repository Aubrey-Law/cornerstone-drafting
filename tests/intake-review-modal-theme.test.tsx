// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ReviewModal } from '@/components/intake/GuidedInterview'

afterEach(cleanup)

const NOOP = () => {}

function renderReviewModal(data: Record<string, unknown> = {}) {
  return render(
    <ReviewModal
      data={data}
      intakeId=""
      isAttorney={false}
      selectedDocKeys={[]}
      legalFlags={[]}
      readinessFlags={[]}
      submitting={false}
      canSubmit
      onEdit={NOOP}
      onClose={NOOP}
      onSubmit={NOOP}
    />,
  )
}

describe('review modal theming', () => {
  it('carries the guided token scope into the portal', () => {
    // Radix renders the dialog into document.body, outside the
    // `.guided-interview` shell that declares --gi-*. Without the class every
    // var() in the modal resolves to nothing and the surface goes transparent.
    renderReviewModal()

    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).not.toBeNull()
    expect(content?.classList.contains('guided-interview')).toBe(true)
  })

  it('titles the summary for the intake track', () => {
    renderReviewModal()
    expect(screen.getByText(/Review your estate plan organizer/)).toBeTruthy()

    cleanup()
    render(
      <ReviewModal
        data={{ intake_track: 'college_prep' }}
        title="Review your College Preparation Plan intake"
        intakeId=""
        isAttorney={false}
        selectedDocKeys={[]}
        legalFlags={[]}
        readinessFlags={[]}
        submitting={false}
        canSubmit
        onEdit={NOOP}
        onClose={NOOP}
        onSubmit={NOOP}
      />,
    )
    expect(screen.getByText(/Review your College Preparation Plan intake/)).toBeTruthy()
  })

  it('styles the summary with theme tokens rather than fixed greys', () => {
    // Fixed `text-gray-900` reads as near-black on the dark guided surface.
    renderReviewModal({ first_name: 'Rowan', last_name: 'Delgado' })

    const content = document.querySelector('[data-slot="dialog-content"]')!
    const classes = Array.from(content.querySelectorAll('*'))
      .flatMap((node) => Array.from(node.classList))

    expect(classes.filter((c) => /^(text|bg|border)-gray-\d+$/.test(c))).toEqual([])
    expect(classes).toContain('text-foreground')
  })
})


it('uses supplied compiled review content without rendering the bundled summary', () => {
  render(<ReviewModal data={{ first_name: 'Bundled-only answer' }} intakeId="" isAttorney={false}
    selectedDocKeys={[]} legalFlags={[]} readinessFlags={[]} submitting={false} canSubmit
    onEdit={NOOP} onClose={NOOP} onSubmit={NOOP}
    reviewContent={<section aria-label="Custom questionnaire review">Custom form content</section>} />)
  expect(screen.getByRole('region', { name: 'Custom questionnaire review' })).toBeTruthy()
  expect(screen.queryByText('Bundled-only answer')).toBeNull()
  expect(screen.getByRole('dialog')).toBeTruthy()
})
