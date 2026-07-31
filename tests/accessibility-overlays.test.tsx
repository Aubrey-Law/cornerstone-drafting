// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetModal } from '@/components/intake/IntakeWizard'
import { ReviewModal } from '@/components/intake/GuidedInterview'

afterEach(cleanup)

describe('intake overlays', () => {
  it('exposes the asset editor as a named dialog and closes on Escape', async () => {
    const onClose = vi.fn()

    render(
      <AssetModal open onClose={onClose} title="Real estate details">
        <p>Asset form</p>
      </AssetModal>,
    )

    expect(screen.getByRole('dialog', { name: 'Real estate details' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('exposes the questionnaire review as a named dialog and closes on Escape', async () => {
    const onClose = vi.fn()

    render(
      <ReviewModal
        data={{}}
        intakeId="intake-1"
        isAttorney={false}
        selectedDocKeys={[]}
        legalFlags={[]}
        readinessFlags={[]}
        submitting={false}
        canSubmit={false}
        onEdit={vi.fn()}
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Review your estate plan organizer' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
