import type { ResolvedTheme, Theme } from './ThemeProvider'

/** Keep palette swaps instant, then restore normal interaction transitions. */
function withoutThemeTransitions(resolved: ResolvedTheme, apply: () => void): void {
  const root = document.documentElement
  const paletteChanged = !root.classList.contains(resolved)
  if (!paletteChanged) {
    apply()
    return
  }

  const style = document.createElement('style')
  style.dataset.themeTransitionGuard = ''
  style.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.append(style)
  apply()
  // Commit the new palette while transitions are suppressed.
  void document.documentElement.offsetHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => style.remove())
  })
}

/**
 * Apply resolved theme to <html> via class + data-theme.
 * Always sets `.light` / `.dark` from the resolved palette so Tailwind `dark:` and
 * scoped CSS (e.g. guided interview) work in system mode too.
 */
export function applyThemeToDocument(theme: Theme, resolved: ResolvedTheme): void {
  const root = document.documentElement

  withoutThemeTransitions(resolved, () => {
    if (theme === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', resolved)
    }

    root.classList.toggle('light', resolved === 'light')
    root.classList.toggle('dark', resolved === 'dark')
  })
}

/** Force light theme (client portal routes). */
export function applyLightThemeToDocument(): void {
  const root = document.documentElement
  withoutThemeTransitions('light', () => {
    root.setAttribute('data-theme', 'light')
    root.classList.add('light')
    root.classList.remove('dark')
  })
}
