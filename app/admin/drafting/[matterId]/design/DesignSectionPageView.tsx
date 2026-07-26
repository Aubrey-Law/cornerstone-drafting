'use client'

import { useLayoutEffect, useRef, type UIEvent } from 'react'
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { guidedCardStyle } from '@/components/guided/styles'
import type { DesignSectionSummary } from '@/lib/designSheetReadiness'
import type { DesignSectionDef } from './designSectionCatalog'

interface DesignSectionPageViewProps {
  section: DesignSectionDef
  sectionIndex: number
  sectionTotal: number
  summary: DesignSectionSummary | undefined
  overviewHref: string
  previousHref: string | null
  nextHref: string | null
  onNavigate?: (href: string) => void
  nextUnresolvedLabel?: string
  onNextUnresolved?: () => void
}

function statusLabel(summary: DesignSectionSummary | undefined) {
  const status = summary?.status ?? 'none'
  if (status === 'complete') return { text: 'Complete', className: 'bg-success/10 text-success' }
  if (status === 'attention') return { text: 'Needs attention', className: 'bg-warning/10 text-warning' }
  if (status === 'override') return { text: 'Override', className: 'bg-muted text-muted-foreground' }
  return { text: 'Not started', className: 'bg-muted text-muted-foreground' }
}

export function DesignSectionPageView({
  section,
  sectionIndex,
  sectionTotal,
  summary,
  overviewHref,
  previousHref,
  nextHref,
  onNavigate,
  nextUnresolvedLabel,
  onNextUnresolved,
}: DesignSectionPageViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const previousSectionIdRef = useRef(section.id)

  useLayoutEffect(() => {
    if (previousSectionIdRef.current !== section.id) {
      previousSectionIdRef.current = section.id
      scrollTopRef.current = 0
    }
    const scrollContainer = scrollContainerRef.current
    if (scrollContainer) scrollContainer.scrollTop = scrollTopRef.current
  }, [section.id])

  const handleSectionScroll = (event: UIEvent<HTMLDivElement>) => {
    scrollTopRef.current = event.currentTarget.scrollTop
  }

  const status = statusLabel(summary)
  const subtitle = section.subtitle
    ?? (summary?.status === 'attention' && summary.missing?.length
      ? `${summary.missing.length} item${summary.missing.length === 1 ? '' : 's'} needed`
      : summary?.detail ?? undefined)

  const handleNavigate = (href: string) => {
    if (onNavigate) {
      onNavigate(href)
      return
    }
    window.location.assign(href)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div style={guidedCardStyle} className="shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Section {sectionIndex + 1} of {sectionTotal}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{section.title}</h2>
            {subtitle && (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <Badge className={cn('border-0 text-[10px]', status.className)}>{status.text}</Badge>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => handleNavigate(overviewHref)}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            All sections
          </Button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        id={`design-section-${section.id}`}
        className="min-h-0 flex-1 overflow-y-auto pb-1"
        onScroll={handleSectionScroll}
      >
        {section.render()}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
        {previousHref ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => handleNavigate(previousHref)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </Button>
        ) : (
          null
        )}
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleNavigate(overviewHref)}>All sections</Button>
        {nextHref ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs"
            onClick={() => handleNavigate(nextHref)}
          >
            Next section
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          null
        )}
        {nextUnresolvedLabel && onNextUnresolved && (
          <Button size="sm" className="ml-auto gap-1 text-xs" onClick={onNextUnresolved}>Next unresolved: {nextUnresolvedLabel}<ChevronRight className="h-3.5 w-3.5" /></Button>
        )}
      </div>
    </div>
  )
}
