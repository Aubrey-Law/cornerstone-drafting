'use client'

import { usePathname } from 'next/navigation'
import { Toaster } from 'sonner'
import { useTheme } from '@/lib/theme/useTheme'
import { isAdminRoute } from '@/lib/theme/routes'

/**
 * sonner's `theme` defaults to "light", not "system", so a bare <Toaster /> shows
 * light toasts over a dark app. This follows the palette actually on the page:
 * the resolved theme on admin routes, and light everywhere else (client routes
 * are pinned light by ThemeProvider even if a dark preference is stored).
 * Must render inside <ThemeProvider>.
 */
export function ThemedToaster() {
  const pathname = usePathname()
  const { resolvedTheme } = useTheme()
  const theme = isAdminRoute(pathname) ? resolvedTheme : 'light'

  return <Toaster richColors position="top-right" theme={theme} />
}
