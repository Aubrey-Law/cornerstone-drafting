'use client'

import Link from 'next/link'
import { ChevronRight, CheckCircle2, AlertCircle, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { guidedCardStyle, guidedIntroCardStyle } from '@/components/guided/styles'
import { ProgressRing } from '@/components/guided'
import type { SummarySectionItem } from '@/components/guided'
import type { DesignSectionDef } from './designSectionCatalog'
import type { DesignSectionSummary } from '@/lib/designSheetReadiness'

interface DesignSectionOverviewProps {
  title: string
  subtitle: string
  pct: number
  groupedSections: {
    attention: DesignSectionDef[]
    remaining: DesignSectionDef[]
    complete: DesignSectionDef[]
  }
  summaries: Record<string, DesignSectionSummary>
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
  groupedSections,
  summaries,
  summarySections,
  sectionHref,
}: DesignSectionOverviewProps) {
  const summaryById = Object.fromEntries(summarySections.map(item => [item.id, item]))

  const renderCards = (sections: DesignSectionDef[], muted = false) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {sections.map((section) => {
        const summaryItem = summaryById[section.id]
        const summary = summaries[section.id]
        const status = summaryItem?.status ?? 'none'
        const blockerCount = summary?.blockers?.length ?? 0
        return (
          <Link key={section.id} href={sectionHref(section.id)} style={guidedCardStyle} className={cn('group flex items-start gap-3 transition-colors hover:border-[var(--gi-teal)] hover:bg-muted/30', muted && 'opacity-60')}>
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground group-hover:bg-[rgba(26,107,114,.1)] group-hover:text-[var(--gi-teal)]">
              {status === 'attention' ? blockerCount : <StatusIcon status={status} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-foreground group-hover:text-[var(--gi-teal)]">{section.title}</span><StatusIcon status={status} /></span>
              {(section.subtitle || blockerCount > 0) && <span className="mt-1 block truncate text-xs text-muted-foreground">{blockerCount > 0 ? `${blockerCount} item${blockerCount === 1 ? '' : 's'} needed` : section.subtitle}</span>}
            </span>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-[var(--gi-teal)]" />
          </Link>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div style={guidedIntroCardStyle}>
        <ProgressRing pct={pct} />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {groupedSections.attention.length > 0 && <section><h3 className="mb-2 text-sm font-semibold">Needs attention</h3>{renderCards(groupedSections.attention)}</section>}
      {groupedSections.remaining.length > 0 && <section><h3 className="mb-2 text-sm font-semibold">Not started or optional</h3>{renderCards(groupedSections.remaining)}</section>}
      {groupedSections.complete.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-muted-foreground">Completed ({groupedSections.complete.length})</summary><div className="mt-2">{renderCards(groupedSections.complete, true)}</div></details>}
    </div>
  )
}
