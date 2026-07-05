'use client'

import Link from 'next/link'
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
}: DesignSectionPageViewProps) {
  const status = statusLabel(summary)
  const subtitle = section.subtitle
    ?? (summary?.status === 'attention' && summary.missing?.length
      ? `${summary.missing.length} item${summary.missing.length === 1 ? '' : 's'} needed`
      : summary?.detail ?? undefined)

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
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
            <Link href={overviewHref}>
              <LayoutGrid className="h-3.5 w-3.5" />
              All sections
            </Link>
          </Button>
        </div>
      </div>

      <div
        id={`design-section-${section.id}`}
        style={guidedCardStyle}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {section.render()}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-3">
        {previousHref ? (
          <Button variant="outline" size="sm" className="gap-1 text-xs" asChild>
            <Link href={previousHref}>
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Button size="sm" className="gap-1 text-xs" asChild>
            <Link href={nextHref}>
              Next section
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
