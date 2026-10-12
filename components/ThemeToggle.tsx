'use client'

import type { ComponentType } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/lib/theme/useTheme'
import { isAdminRoute } from '@/lib/theme/routes'
import type { Theme } from '@/lib/theme/ThemeProvider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const OPTIONS: Theme[] = ['light', 'dark', 'system']

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

interface ThemeToggleProps {
  collapsed?: boolean
  /** 'sidebar' for nav rail; 'default' for the top header bar. */
  variant?: 'sidebar' | 'default'
}

/**
 * A menu rather than a one-click cycle: "System" follows the OS, so what the
 * next click does isn't visible from the current icon. The menu shows all three
 * choices and marks the active one.
 */
export function ThemeToggle({ collapsed = false, variant = 'default' }: ThemeToggleProps) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  if (!isAdminRoute(pathname)) return null

  const Icon = ICONS[theme]
  const isSidebar = variant === 'sidebar'
  const label = `Theme: ${LABELS[theme]}`

  const trigger = isSidebar ? (
    <button
      type="button"
      aria-label={collapsed ? label : 'Appearance'}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md border-0 bg-transparent text-sm transition-colors',
        collapsed ? 'justify-center px-2 py-2' : 'w-full gap-3 px-3 py-2',
        'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? <span>Appearance</span> : null}
    </button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 px-2 text-xs"
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{LABELS[theme]}</span>
    </Button>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={isSidebar ? 'top' : 'bottom'} align={isSidebar ? 'start' : 'end'}>
        <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as Theme)}>
          {OPTIONS.map(option => {
            const OptionIcon = ICONS[option]
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon className="mr-2 h-4 w-4" />
                {LABELS[option]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
