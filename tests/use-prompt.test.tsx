// @vitest-environment jsdom

import React, { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePrompt, type PromptOptions } from '@/components/useConfirm'

/**
 * The contract that `window.prompt` did not have.
 *
 * `window.prompt` answers Cancel with null and an empty submit with '', and
 * both are falsy. Every call site in this app tested the result for truthiness,
 * so the two answers took the same branch — which on the client signing page
 * meant pressing Cancel declined the agreement.
 *
 * `usePrompt` resolves null for "backed out" and a string for "confirmed",
 * including '' when the field was optional and left blank. These pin that
 * distinction, because it is the whole reason the hook exists.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.hasPointerCapture = vi.fn(() => false)
Element.prototype.releasePointerCapture = vi.fn()

afterEach(cleanup)

/** Renders a button that opens the prompt and records exactly what it resolved. */
function Harness({ options }: { options: PromptOptions }) {
  const { prompt, promptDialog } = usePrompt()
  const [result, setResult] = useState<{ value: string | null } | null>(null)

  return (
    <div>
      <button onClick={() => void prompt(options).then(value => setResult({ value }))}>Open</button>
      {/* Rendered distinctly so "resolved null" and "resolved empty string" can
          never be read as the same outcome by the assertions below. */}
      {result && <p data-testid="result">{result.value === null ? 'NULL' : `STRING:${result.value}`}</p>}
      {promptDialog}
    </div>
  )
}

const BASE: PromptOptions = { title: 'Cancel this agreement?', label: 'Why?' }

async function open(options: PromptOptions = BASE) {
  const user = userEvent.setup()
  render(<Harness options={options} />)
  await user.click(screen.getByRole('button', { name: 'Open' }))
  await screen.findByRole('alertdialog')
  return user
}

describe('usePrompt', () => {
  it('resolves null when the cancel button is used', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await screen.findByTestId('result')).textContent).toBe('NULL')
  })

  it('resolves null when dismissed with Escape', async () => {
    // Dismissing is backing out, not submitting an empty answer.
    const user = await open()
    await user.keyboard('{Escape}')
    expect((await screen.findByTestId('result')).textContent).toBe('NULL')
  })

  it('resolves an empty string when an optional field is confirmed blank', async () => {
    // The case that collapsed under window.prompt: this is a yes, not a no.
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByTestId('result')).textContent).toBe('STRING:')
  })

  it('resolves the typed value, trimmed', async () => {
    const user = await open()
    await user.type(screen.getByLabelText('Why?'), '   terms changed   ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByTestId('result')).textContent).toBe('STRING:terms changed')
  })

  it('holds the action until a required field has something in it', async () => {
    const user = await open({ ...BASE, required: true })
    const action = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(action.disabled).toBe(true)

    // Whitespace is not an answer.
    await user.type(screen.getByLabelText('Why?'), '   ')
    expect(action.disabled).toBe(true)

    await user.type(screen.getByLabelText('Why?'), 'a reason')
    await waitFor(() => expect(action.disabled).toBe(false))
  })

  it('holds the action until a type-to-confirm matches exactly', async () => {
    const user = await open({ ...BASE, requireExact: 'pour-over-will' })
    const action = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

    await user.type(screen.getByLabelText('Why?'), 'pour-over-wil')
    expect(action.disabled).toBe(true)

    await user.type(screen.getByLabelText('Why?'), 'l')
    await waitFor(() => expect(action.disabled).toBe(false))
  })

  it('starts empty on reopen rather than carrying the last answer', async () => {
    // A stale reason attached to the next agreement would be worse than none.
    const user = await open()
    await user.type(screen.getByLabelText('Why?'), 'first time')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByRole('alertdialog')
    expect((screen.getByLabelText('Why?') as HTMLInputElement).value).toBe('')
  })

  it('settles rather than hanging when the owner unmounts', async () => {
    // An unsettled promise leaves the caller's `finally` unreached, so a
    // spinner started before the question spins for the life of the page.
    const user = userEvent.setup()
    const { unmount } = render(<Harness options={BASE} />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByRole('alertdialog')
    expect(() => unmount()).not.toThrow()
  })
})
