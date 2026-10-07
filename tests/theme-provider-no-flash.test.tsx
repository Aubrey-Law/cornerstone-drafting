// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const applyThemeToDocument = vi.fn()
const applyLightThemeToDocument = vi.fn()

vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }))
vi.mock('@/lib/theme/apply-theme', () => ({
  applyThemeToDocument: (...args: unknown[]) => applyThemeToDocument(...args),
  applyLightThemeToDocument: () => applyLightThemeToDocument(),
}))

let mockPathname = '/admin/drafting'

import { ThemeProvider } from '@/lib/theme/ThemeProvider'

function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/**
 * THEME_INIT_SCRIPT paints the stored theme before React hydrates. The
 * provider starts from a placeholder ('system' / 'light') so server and client
 * agree; applying that placeholder would flip a stored-dark admin to light for
 * a frame and then back. Nothing may be applied until the stored value is read.
 */
describe('ThemeProvider first mount', () => {
  beforeEach(() => {
    applyThemeToDocument.mockClear()
    applyLightThemeToDocument.mockClear()
    localStorage.clear()
    mockPathname = '/admin/drafting'
    stubMatchMedia(false)
  })

  it('never applies the placeholder theme over a stored dark preference', () => {
    localStorage.setItem('aubrey_theme', 'dark')
    render(<ThemeProvider>{null}</ThemeProvider>)

    expect(applyThemeToDocument).toHaveBeenCalled()
    for (const call of applyThemeToDocument.mock.calls) {
      expect(call).toEqual(['dark', 'dark'])
    }
  })

  it('applies the system preference when nothing is stored', () => {
    stubMatchMedia(true)
    render(<ThemeProvider>{null}</ThemeProvider>)

    for (const call of applyThemeToDocument.mock.calls) {
      expect(call).toEqual(['system', 'dark'])
    }
    expect(applyThemeToDocument).toHaveBeenCalled()
  })

  it('still forces light on client routes', () => {
    mockPathname = '/dashboard'
    localStorage.setItem('aubrey_theme', 'dark')
    render(<ThemeProvider>{null}</ThemeProvider>)

    expect(applyLightThemeToDocument).toHaveBeenCalled()
    expect(applyThemeToDocument).not.toHaveBeenCalled()
  })
})
