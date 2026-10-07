// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toasterProps = vi.fn()
let mockPathname = '/admin/drafting'
let mockResolved: 'light' | 'dark' = 'dark'

vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => {
    toasterProps(props)
    return null
  },
}))
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }))
vi.mock('@/lib/theme/useTheme', () => ({
  useTheme: () => ({ theme: mockResolved, resolvedTheme: mockResolved, setTheme: () => {} }),
}))

import { ThemedToaster } from '@/components/ThemedToaster'

const lastTheme = () => toasterProps.mock.calls.at(-1)?.[0].theme

/**
 * sonner defaults `theme` to "light" — not "system" — so an un-themed Toaster
 * paints light toasts over a dark admin app.
 */
describe('ThemedToaster', () => {
  beforeEach(() => {
    toasterProps.mockClear()
    mockPathname = '/admin/drafting'
    mockResolved = 'dark'
  })

  it('follows the resolved theme on admin routes', () => {
    render(<ThemedToaster />)
    expect(lastTheme()).toBe('dark')

    mockResolved = 'light'
    render(<ThemedToaster />)
    expect(lastTheme()).toBe('light')
  })

  it('stays light on client routes even when a dark preference is stored', () => {
    mockPathname = '/dashboard'
    mockResolved = 'dark'
    render(<ThemedToaster />)
    expect(lastTheme()).toBe('light')
  })

  it('keeps the existing placement and rich colours', () => {
    render(<ThemedToaster />)
    expect(toasterProps.mock.calls.at(-1)?.[0]).toMatchObject({ richColors: true, position: 'top-right' })
  })
})

describe('root layout', () => {
  const layout = readFileSync(join(__dirname, '..', 'app/layout.tsx'), 'utf8')

  it('mounts the themed toaster inside ThemeProvider, not a bare sonner Toaster', () => {
    expect(layout).not.toMatch(/from 'sonner'/)
    const provider = layout.slice(layout.indexOf('<ThemeProvider>'), layout.indexOf('</ThemeProvider>'))
    expect(provider).toContain('<ThemedToaster />')
  })
})
