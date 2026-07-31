'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const MOBILE_QUERY = '(max-width: 767px)'

export function isMobileDetailViewport(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_QUERY).matches
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return mobile
}

type ResponsiveDetailRailProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  children: ReactNode
  desktopClassName?: string
  mobileClassName?: string
}

export function ResponsiveDetailRail({
  open,
  onOpenChange,
  label,
  children,
  desktopClassName,
  mobileClassName,
}: ResponsiveDetailRailProps) {
  const mobile = useIsMobile()

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className={cn('w-[min(22rem,100vw)] gap-0 p-0 sm:max-w-none', mobileClassName)}
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
      className={cn('hidden min-h-0 shrink-0 md:flex', desktopClassName)}
    >
      {children}
    </aside>
  )
}
