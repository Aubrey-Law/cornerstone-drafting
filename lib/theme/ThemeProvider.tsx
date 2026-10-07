'use client'

import { createContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { applyLightThemeToDocument, applyThemeToDocument } from './apply-theme'
import { isAdminRoute } from './routes'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'aubrey_theme'

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
  // The placeholder state above ('system' / 'light') only exists so the server
  // and first client render agree. Applying it would flip a stored-dark admin
  // back to light for a frame before the stored value is read, undoing what
  // THEME_INIT_SCRIPT already painted — so nothing is applied until it's read.
  const [hydrated, setHydrated] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    const initial: Theme =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
    const resolved: ResolvedTheme = initial === 'system' ? getSystemTheme() : initial
    setThemeState(initial)
    setResolvedTheme(resolved)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    if (!isAdminRoute(pathname)) {
      applyLightThemeToDocument()
      return
    }
    applyThemeToDocument(theme, resolvedTheme)
  }, [hydrated, pathname, theme, resolvedTheme])

  useEffect(() => {
    if (theme !== 'system' || !isAdminRoute(pathname)) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme, pathname])

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    const resolved: ResolvedTheme = next === 'system' ? getSystemTheme() : next
    setThemeState(next)
    setResolvedTheme(resolved)
    if (isAdminRoute(pathname)) {
      applyThemeToDocument(next, resolved)
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
