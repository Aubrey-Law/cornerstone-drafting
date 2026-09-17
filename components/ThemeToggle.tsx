'use client'

import type { ComponentType } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/lib/theme/useTheme'
import { isAdminRoute } from '@/lib/theme/routes'
import type { Theme } from '@/lib/theme/ThemeProvider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CYCLE: Theme[] = ['light', 'dark', 'system']

const LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const ICONS: Record<Theme, ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const NEXT_LABEL: Record<Theme, string> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

interface ThemeToggleProps {
  collapsed?: boolean
  /** 'sidebar' for nav rail; 'default' for the top header bar. */
  variant?: 'sidebar' | 'default'
}

export function ThemeToggle({ collapsed = false, variant = 'default' }: ThemeToggleProps) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  if (!isAdminRoute(pathname)) return null

  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length]
  const Icon = ICONS[theme]
  const isSidebar = variant === 'sidebar'

  if (isSidebar) {
    return (
      <button
        type="button"
        onClick={() => setTheme(next)}
        aria-label={`Theme: ${LABELS[theme]}. Switch to ${NEXT_LABEL[theme]}`}
        className={cn(
          'flex items-center rounded-md border-0 bg-transparent text-sm transition-colors',
          collapsed ? 'justify-center px-2 py-2' : 'w-full gap-3 px-3 py-2',
          'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed ? <span>{LABELS[theme]}</span> : null}
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${NEXT_LABEL[theme]}`}
      title={`Theme: ${LABELS[theme]}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{LABELS[theme]}</span>
    </Button>
  )
}
