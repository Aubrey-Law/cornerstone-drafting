// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewModeSwitch } from '@/components/ViewModeSwitch'

describe('ViewModeSwitch', () => {
  afterEach(() => cleanup())

  it('marks the selected view and reports a change', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ViewModeSwitch value="table" modes={['grid', 'table', 'board'] as const} onChange={onChange} />)

    const table = screen.getByRole('button', { name: 'Table' })
    expect(table.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Grid' }).getAttribute('aria-pressed')).toBe('false')

    await user.click(screen.getByRole('button', { name: 'Board' }))
    expect(onChange).toHaveBeenCalledWith('board')
  })
})
