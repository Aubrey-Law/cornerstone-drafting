import type { ResolvedTheme, Theme } from './ThemeProvider'

/**
 * Apply resolved theme to <html> via class + data-theme.
 * System mode clears explicit markers so CSS @media (prefers-color-scheme) applies.
 */
export function applyThemeToDocument(theme: Theme, resolved: ResolvedTheme): void {
  const root = document.documentElement

  if (theme === 'system') {
    root.removeAttribute('data-theme')
    root.classList.remove('light', 'dark')
    return
  }

  root.setAttribute('data-theme', resolved)
  root.classList.toggle('light', resolved === 'light')
  root.classList.toggle('dark', resolved === 'dark')
}

/** Force light theme (client portal routes). */
export function applyLightThemeToDocument(): void {
  const root = document.documentElement
  root.setAttribute('data-theme', 'light')
  root.classList.add('light')
  root.classList.remove('dark')
}
