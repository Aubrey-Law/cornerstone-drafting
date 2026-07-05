'use client'

import Link from 'next/link'
import { ChevronRight, CheckCircle2, AlertCircle, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { guidedCardStyle, guidedIntroCardStyle } from '@/components/guided/styles'
import { ProgressRing } from '@/components/guided'
import type { SummarySectionItem } from '@/components/guided'
import type { DesignSectionDef } from './designSectionCatalog'

interface DesignSectionOverviewProps {
  title: string
  subtitle: string
  pct: number
  sections: DesignSectionDef[]
  summarySections: SummarySectionItem[]
  sectionHref: (sectionId: string) => string
}

function StatusIcon({ status }: { status: SummarySectionItem['status'] }) {
  if (status === 'complete') return <CheckCircle2 className="h-4 w-4 text-success" />
  if (status === 'attention') return <AlertCircle className="h-4 w-4 text-warning" />
  return <Circle className="h-4 w-4 text-muted-foreground" />
}

export function DesignSectionOverview({
  title,
  subtitle,
  pct,
  sections,
  summarySections,
  sectionHref,
}: DesignSectionOverviewProps) {
  const summaryById = Object.fromEntries(summarySections.map(item => [item.id, item]))

  return (
    <div className="flex flex-col gap-4">
      <div style={guidedIntroCardStyle}>
        <ProgressRing pct={pct} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {sections.map((section, index) => {
          const summaryItem = summaryById[section.id]
          const status = summaryItem?.status ?? 'none'
          return (
            <Link
              key={section.id}
              href={sectionHref(section.id)}
              style={guidedCardStyle}
              className={cn(
                'group flex items-start gap-3 transition-colors hover:border-[var(--gi-teal)] hover:bg-muted/30',
              )}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground group-hover:bg-[rgba(26,107,114,.1)] group-hover:text-[var(--gi-teal)]">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground group-hover:text-[var(--gi-teal)]">
                    {section.title}
                  </span>
                  <StatusIcon status={status} />
                </span>
                {(section.subtitle || (summaryItem?.missingCount && summaryItem.missingCount > 0)) && (
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {section.subtitle
                      ?? `${summaryItem?.missingCount} item${summaryItem?.missingCount === 1 ? '' : 's'} needed`}
                  </span>
                )}
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[var(--gi-teal)]" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
