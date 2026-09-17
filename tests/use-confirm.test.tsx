// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useConfirm } from '@/components/useConfirm'

afterEach(cleanup)

/**
 * The ten destructive actions that used to ask through `window.confirm` now ask
 * through this. The native dialog got one thing right for free — it could not
 * resolve until the person answered — so that is what these cases pin down.
 */

function Harness({ onResult }: { onResult: (value: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm()
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          onResult(
            await confirm({
              title: 'Delete this asset?',
              body: 'This cannot be undone.',
              confirmLabel: 'Delete asset',
              destructive: true,
            }),
          )
        }}
      >
        Delete
      </button>
      {confirmDialog}
    </div>
  )
}

describe('useConfirm', () => {
  it('shows nothing until something asks', () => {
    render(<Harness onResult={() => {}} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('resolves true when the action is taken', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()
    render(<Harness onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(onResult).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete asset' }))
    expect(onResult).toHaveBeenCalledWith(true)
  })

  it('resolves false when cancelled', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()
    render(<Harness onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onResult).toHaveBeenCalledWith(false)
  })

  it('carries the question and its consequence into the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness onResult={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('alertdialog')

    expect(screen.getByText('Delete this asset?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  /**
   * The failure mode a promise-based confirm adds that `window.confirm` could
   * not have: a caller does `setBusy(true)`, awaits, and the owner unmounts
   * while the dialog is open. A promise that never settles leaves that handler
   * parked before its `finally` forever.
   */
  it('resolves false rather than hanging when its owner unmounts', async () => {
    const onResult = vi.fn()
    const user = userEvent.setup()
    const { unmount } = render(<Harness onResult={onResult} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByRole('alertdialog')
    expect(onResult).not.toHaveBeenCalled()

    unmount()
    await act(async () => {})

    expect(onResult).toHaveBeenCalledWith(false)
  })
})
