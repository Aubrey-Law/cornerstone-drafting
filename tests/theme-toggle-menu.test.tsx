// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const setTheme = vi.fn()
let mockTheme: 'light' | 'dark' | 'system' = 'system'
let mockPathname = '/admin/drafting'

vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }))
vi.mock('@/lib/theme/useTheme', () => ({
  useTheme: () => ({ theme: mockTheme, resolvedTheme: 'light', setTheme }),
}))

import { ThemeToggle } from '@/components/ThemeToggle'

describe('ThemeToggle menu', () => {
  beforeEach(() => {
    setTheme.mockClear()
    mockTheme = 'system'
    mockPathname = '/admin/drafting'
  })

  it('labels the expanded rail control Appearance', () => {
    mockTheme = 'dark'
    render(<ThemeToggle variant="sidebar" />)
    const button = screen.getByRole('button', { name: 'Appearance' })
    expect(button.textContent).toContain('Appearance')
  })

  it('keeps an icon-only theme tooltip when the rail is collapsed', () => {
    mockTheme = 'dark'
    render(<ThemeToggle variant="sidebar" collapsed />)
    const button = screen.getByRole('button', { name: 'Theme: Dark' })
    expect(button.getAttribute('title')).toBe('Theme: Dark')
    expect(button.textContent).not.toContain('Appearance')
  })

  it('lists all three choices, marks the active one, and applies a pick', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('button', { name: 'Theme: System' }))

    const items = screen.getAllByRole('menuitemradio')
    expect(items.map(item => item.textContent)).toEqual(['Light', 'Dark', 'System'])
    expect(items.map(item => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])

    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('renders nothing outside admin routes', () => {
    mockPathname = '/dashboard'
    const { container } = render(<ThemeToggle />)
    expect(container.firstChild).toBeNull()
  })
})
