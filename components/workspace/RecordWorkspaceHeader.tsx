import Link from 'next/link'
import { ArrowLeft, PanelRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The record name's type scale; the matter page renders it inside its switcher. */
export function recordTitleClass(collapsed: boolean) {
  return cn('font-semibold tracking-tight', collapsed ? 'text-lg' : 'text-xl sm:text-2xl')
}

/**
 * The record workspace header shared by the matter and lead pages: back link,
 * name, identity chips and meta line, actions on the right, then the stage
 * row and the tab bar. `collapsed` keeps only the name, actions and tabs.
 */
export function RecordWorkspaceHeader({
  backHref,
  backLabel,
  title,
  chips = [],
  meta,
  actions,
  stage,
  navigation,
  collapsed = false,
}: {
  backHref: string
  backLabel: string
  /** The h1 content; style plain text with `recordTitleClass`. */
  title: ReactNode
  chips?: ReactNode[]
  /** After the chips: record number, opened date, status. */
  meta?: ReactNode
  actions: ReactNode
  stage?: ReactNode
  navigation?: ReactNode
  collapsed?: boolean
}) {
  return (
    <header data-collapsed={collapsed || undefined} className={cn('shrink-0 border-b border-border bg-card px-4 md:px-6', collapsed ? 'pt-2' : 'pt-5')}>
      <div className={cn('flex flex-wrap justify-between gap-3', collapsed ? 'items-center' : 'items-start')}>
        <div className="min-w-0 flex-1 basis-48">
          {!collapsed && <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden />{backLabel}
          </Link>}
          <h1 className={cn('min-w-0', !collapsed && 'mt-1')}>{title}</h1>
          {!collapsed && (chips.length > 0 || meta) && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {chips.map((chip, index) => typeof chip === 'string'
              ? <Badge key={chip} variant="outline" className="rounded-md font-medium">{chip}</Badge>
              : <span key={index}>{chip}</span>)}
            {meta}
          </div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      {stage && !collapsed && <div className="mt-5">{stage}</div>}
      {navigation && <div className={cn('-mx-4 md:-mx-6', collapsed ? 'mt-1' : 'mt-4')}>{navigation}</div>}
    </header>
  )
}

/** The Details toggle: outline, `selected` while the panel is open. */
export function RecordDetailsButton({ open, onToggle, record }: { open: boolean; onToggle: () => void; record: string }) {
  return (
    <Button type="button" size="sm" variant={open ? 'selected' : 'outline'} onClick={onToggle}
      aria-pressed={open} aria-label={open ? `Hide ${record} details` : `Show ${record} details`}>
      <PanelRight className="size-4" aria-hidden />
      <span className="hidden sm:inline">Details</span>
    </Button>
  )
}

/** Tab styling shared by the record workspaces' tab bars. */
export const WORKSPACE_TAB_CLASS = 'shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
export const WORKSPACE_TAB_TRIGGER_CLASS = 'h-auto rounded-none border-0 border-b-2 data-[state=active]:border-selected-border data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-selected-foreground'
export const WORKSPACE_TABS_LIST_CLASS = 'h-auto w-max flex-nowrap justify-start gap-0.5 rounded-none bg-transparent p-0'

export function WorkspaceTabCount({ count }: { count: number }) {
  return <span className="ml-1.5 rounded bg-muted px-1.5 text-xs tabular-nums">{count}</span>
}
