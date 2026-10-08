'use client'

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAdminRailVisible } from '@/components/rail/AdminRailVisibilityContext'

const MOBILE_QUERY = '(max-width: 767px)'
const BELOW_LG_QUERY = '(max-width: 1023px)'

export function isMobileDetailViewport(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_QUERY).matches
}

/** Reactive twin of `isMobileDetailViewport` for callers that lay out around the rail. */
export function useIsMobileDetailViewport(): boolean {
  return useIsMobile()
}

function useIsMobile(): boolean {
  return useMatches(MOBILE_QUERY)
}

function useMatches(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

type ResponsiveDetailRailProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: ReactNode
  desktopClassName?: string
  /** Escape hatch for docked positioning that depends on a runtime offset. */
  desktopStyle?: CSSProperties
  drawer?: boolean
  side?: 'left' | 'right'
  collapseBelow?: 'md' | 'lg'
  /** Use a sheet when the global admin rail already occupies the right edge. */
  collapseWithAdminRail?: boolean
  /** Disable when an editor owns Escape to cancel its draft. */
  blurOnEscape?: boolean
  mobileClassName?: string
}

export function ResponsiveDetailRail({
  open,
  onOpenChange,
  label,
  children,
  desktopClassName,
  desktopStyle,
  mobileClassName,
  drawer = false,
  side = 'left',
  collapseBelow = 'md',
  collapseWithAdminRail = false,
  blurOnEscape = true,
}: ResponsiveDetailRailProps) {
  const adminRailVisible = useAdminRailVisible()
  const collapsed = useMatches(collapseBelow === 'lg' ? BELOW_LG_QUERY : MOBILE_QUERY)
    || (collapseWithAdminRail && adminRailVisible)
  const sheetSide = drawer ? 'right' : side
  const protectInlineEdits = drawer || side === 'right'

  if (collapsed || drawer) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={sheetSide}
          className={cn('w-[min(30rem,100vw)] gap-0 p-0 sm:max-w-none', mobileClassName)}
          onInteractOutside={event => { if (protectInlineEdits) event.preventDefault() }}
          onEscapeKeyDown={event => {
            if (!protectInlineEdits) return
            const field = document.activeElement
            if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
              // Inline fields save on blur. Let that finish before dismissing.
              event.preventDefault()
              if (blurOnEscape) field.blur()
            }
          }}
          // Focus the sheet itself, not its first field: on the matter facts
          // that is the client's name, which then opened selected for editing
          // and raised the phone keyboard over the panel.
          onOpenAutoFocus={event => {
            event.preventDefault()
            ;(event.currentTarget as HTMLElement | null)?.focus()
          }}
        >
          <SheetTitle className="sr-only">{label}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    )
  }

  if (!open) return null

  return (
    <aside
      aria-label={label}
      style={desktopStyle}
      className={cn(
        'hidden min-h-0 shrink-0',
        collapseBelow === 'lg' ? 'lg:flex' : 'md:flex',
        desktopClassName,
      )}
    >
      {children}
    </aside>
  )
}
