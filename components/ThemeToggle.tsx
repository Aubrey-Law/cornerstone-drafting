'use client'

import { Sun, Moon, Monitor } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/lib/theme/useTheme'
import { isAdminRoute } from '@/lib/theme/routes'
import type { Theme } from '@/lib/theme/ThemeProvider'

const CYCLE: Theme[] = ['light', 'dark', 'system']

const LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const ICONS: Record<Theme, React.ComponentType<{ size: number; strokeWidth: number }>> = {
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
  /** 'sidebar' uses sidebar-foreground/sidebar-accent tokens (for the dark nav).
   *  'default' uses foreground/muted tokens (for the header bar). */
  variant?: 'sidebar' | 'default'
}

export function ThemeToggle({ collapsed = false, variant = 'sidebar' }: ThemeToggleProps) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()

  if (!isAdminRoute(pathname)) return null

  const next = CYCLE[(CYCLE.indexOf(theme) + 1) % CYCLE.length]
  const Icon = ICONS[theme]

  const isSidebar = variant === 'sidebar'
  const color = isSidebar ? 'var(--sidebar-foreground)' : 'var(--foreground)'
  const hoverBg = isSidebar ? 'var(--sidebar-accent)' : 'var(--muted)'

  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${NEXT_LABEL[theme]}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: collapsed ? 0 : '12px',
        width: collapsed ? 'auto' : '100%',
        padding: collapsed ? '6px 8px' : '8px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: '4px',
        border: 'none',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        color,
        fontSize: '14px',
        lineHeight: '20px',
        transition: 'background-color 0.15s, opacity 0.15s',
        opacity: 0.75,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = hoverBg
        e.currentTarget.style.opacity = '1'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.opacity = '0.75'
      }}
    >
      <Icon size={16} strokeWidth={1.75} />
      {!collapsed && <span>{LABELS[theme]}</span>}
    </button>
  )
}
