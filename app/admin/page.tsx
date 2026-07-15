import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Inbox,
  MessageSquare,
  Phone,
  Send,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DailyBriefCard } from '@/app/admin/components/DailyBriefCard'
import { fetchTodayData, type TodayUnreadThread } from '@/lib/queries/today'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import { stageLabel, type MatterStage, type PipelineMatter } from '@/types/database'
import type { MatterAgingRow } from '@/lib/queries/pipelineAging'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const AGING_TONE: Record<string, string> = {
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
}

function SectionCard({
  title,
  icon: Icon,
  count,
  emptyText,
  children,
  action,
}: {
  title: string
  icon: React.ElementType
  count: number
  emptyText: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {count > 0 && <Badge variant="secondary" className="text-[11px]">{count}</Badge>}
        </div>
        {action}
      </header>
      {count === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">{children}</ul>
      )}
    </section>
  )
}

function RowLink({
  href,
  primary,
  secondary,
  meta,
  cta,
}: {
  href: string
  primary: string
  secondary?: string | null
  meta?: React.ReactNode
  cta: string
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{primary}</span>
            {meta}
          </div>
          {secondary && <p className="mt-0.5 truncate text-xs text-muted-foreground">{secondary}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          {cta}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </Link>
    </li>
  )
}

function atRiskRow(row: MatterAgingRow) {
  const days = row.days_over_sla != null && row.days_over_sla > 0
    ? `${row.days_over_sla} day${row.days_over_sla === 1 ? '' : 's'} over SLA`
    : `${row.days_in_stage} day${row.days_in_stage === 1 ? '' : 's'} in stage`
  return (
    <RowLink
      key={`${row.entity}:${row.id}`}
      href={row.entity === 'lead' ? `/admin/leads/${row.id}` : `/admin/matters/${row.id}`}
      primary={row.client_name ?? `Unnamed ${row.entity}`}
      secondary={`${engineStageLabel(row.current_stage)} · ${days} · ball in ${row.owner === 'client' ? "client's" : 'your'} court`}
      meta={
        <Badge variant="outline" className={cn('text-[10px] capitalize', AGING_TONE[row.health])}>
          {row.health}
        </Badge>
      }
      cta={`Open ${row.entity}`}
    />
  )
}

function unreadRow(thread: TodayUnreadThread) {
  return (
    <RowLink
      key={thread.matter_id}
      href={`/admin/matters/${thread.matter_id}?tab=communications`}
      primary={thread.client_name ?? 'Unnamed matter'}
      secondary={`${thread.unread_count} unread message${thread.unread_count === 1 ? '' : 's'}`}
      cta="Read & reply"
    />
  )
}

function matterRow(matter: PipelineMatter, cta: string, href: string) {
  return (
    <RowLink
      key={matter.matter_id}
      href={href}
      primary={matter.client_name ?? matter.matter_name ?? 'Unnamed matter'}
      secondary={stageLabel(matter.stage as MatterStage)}
      cta={cta}
    />
  )
}

export default async function AdminTodayPage() {
  const today = await fetchTodayData()
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date())

  const needsMe =
    today.atRisk.length +
    today.unreadThreads.length +
    today.intakeReview.length +
    today.intakeToSend.length

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Today</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {dateLabel} · {today.activeMatterCount} active matter{today.activeMatterCount === 1 ? '' : 's'}
          {needsMe === 0
            ? ' · nothing is waiting on you'
            : ` · ${needsMe} item${needsMe === 1 ? '' : 's'} waiting on you`}
        </p>
      </header>

      <DailyBriefCard />

      <SectionCard
        title="Overdue & at risk"
        icon={AlertTriangle}
        count={today.atRisk.length}
        emptyText="No matters are over or approaching their stage SLA."
        action={
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
            <Link href="/admin/pipeline/aging">Aging board</Link>
          </Button>
        }
      >
        {today.atRisk.slice(0, 8).map(atRiskRow)}
        {today.atRisk.length > 8 && (
          <li className="px-4 py-2 text-xs text-muted-foreground">
            <Link href="/admin/pipeline/aging" className="hover:underline">
              +{today.atRisk.length - 8} more on the aging board
            </Link>
          </li>
        )}
      </SectionCard>

      <SectionCard
        title="Unread client messages"
        icon={MessageSquare}
        count={today.unreadThreads.length}
        emptyText="No unread messages from clients."
      >
        {today.unreadThreads.map(unreadRow)}
      </SectionCard>

      <SectionCard
        title="Intake ready for review"
        icon={ClipboardCheck}
        count={today.intakeReview.length}
        emptyText="No submitted intakes are waiting on review."
      >
        {today.intakeReview.map(m => matterRow(m, 'Review & draft', `/admin/drafting/${m.matter_id}`))}
      </SectionCard>

      <SectionCard
        title="Intake to send"
        icon={Send}
        count={today.intakeToSend.length}
        emptyText="Every open matter has its intake questionnaire out."
      >
        {today.intakeToSend.map(m => matterRow(m, 'Send intake', `/admin/matters/${m.matter_id}`))}
      </SectionCard>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        <Link href="/admin/calls" className="inline-flex items-center gap-1.5 hover:text-foreground">
          <Phone className="h-3.5 w-3.5" aria-hidden />
          {today.unassignedCallCount === 0
            ? 'All calls are linked to leads or matters'
            : `${today.unassignedCallCount} call${today.unassignedCallCount === 1 ? '' : 's'} not linked to a lead or matter`}
        </Link>
        <Link href="/admin/matters" className="inline-flex items-center gap-1.5 hover:text-foreground">
          <Inbox className="h-3.5 w-3.5" aria-hidden />
          All matters
        </Link>
      </footer>
    </div>
  )
}
