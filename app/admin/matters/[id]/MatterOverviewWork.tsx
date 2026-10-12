'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/FilterChip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'
import type { MatterNextAction } from '@/lib/matterNextAction'
import { evaluateMatterRequirements, type EngagementState } from '@/lib/lifecycle/matter'
import { resolveIntakeReviewTarget, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { cn, FIRM_TIMEZONE, formatDate } from '@/lib/utils'
import { nextMatterMilestone } from '@/lib/matter/nextMilestone'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { PipelineMatter, MatterActivity } from '@/types/database'
import { activityEventTitle, eventMetaFor } from './activityEventMeta'

const NEED_LABELS: Record<string, string> = {
  'matter.design_ready': 'Approve the design sheet',
  'matter.drafts_shared': 'Share reviewed drafts with the client',
  'matter.engagement_signed': 'Engagement signature outstanding',
  'matter.signing_scheduled': 'Schedule the signing appointment',
  'matter.documents_executed': 'Record document execution',
}

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const ACTIVITY_WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: FIRM_TIMEZONE })

type FeedFilter = 'all' | 'messages' | 'notes' | 'documents' | 'system'
const FEED_FILTERS: FeedFilter[] = ['all', 'messages', 'notes', 'documents', 'system']
const ACTIVITY_PREVIEW = 5

interface PrepItem {
  key: string
  label: string
  done: boolean
  tag?: string
  cta?: string
  href?: string
  onClick?: () => void
}

function relativeDays(daysAway: number) {
  if (daysAway < 0) return `${Math.abs(daysAway)} day${daysAway === -1 ? '' : 's'} overdue`
  if (daysAway === 0) return 'Today'
  return `In ${daysAway} day${daysAway === 1 ? '' : 's'}`
}

/** Snoozing wakes the item at 8am local on the chosen day. */
function wakeAt(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(8, 0, 0, 0)
  return date.toISOString()
}

export function MatterOverviewWork({ matter, nextAction, workSummary, engagement, reviewFlags, unreadCount, uploadCount, details = null, onDates, activity, onEngagement, onUploads, onMessages, onActivity, onSnooze, sidebar, composer }: {
  sidebar?: ReactNode
  composer?: ReactNode
  matter: PipelineMatter
  nextAction: MatterNextAction
  workSummary: RecordWorkSummary | null
  engagement?: EngagementState
  reviewFlags: IntakeReadinessFlag[]
  unreadCount: number
  uploadCount: number
  signingDate?: string | null
  details?: MatterDetailsRow | null
  onDates?: () => void
  activity: MatterActivity[]
  onEngagement: () => void
  onUploads: () => void
  onMessages: () => void
  onActivity: () => void
  /** Snoozes the summarized work item until the given ISO time; omitted where snoozing is unsupported. */
  onSnooze?: (workKey: string, until: string) => void | Promise<void>
}) {
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
  const feed = activity.filter(item => {
    const communication = /message|email|sms|call/.test(item.event_type) || item.metadata?.channel === 'call' || item.metadata?.type === 'client_comm'
    const document = /document|draft/.test(item.event_type)
    if (feedFilter === 'messages') return communication
    if (feedFilter === 'notes') return item.event_type === 'note_added' && !communication
    if (feedFilter === 'documents') return document
    if (feedFilter === 'system') return !communication && !document && item.event_type !== 'note_added'
    return true
  })
  const engagementAction = nextAction.kind === 'send-engagement' || nextAction.kind === 'waiting-engagement'
  const useSummary = workSummary && !/:(send-intake|waiting-intake)$/.test(workSummary.workKey) && !(engagementAction && workSummary.title === nextAction.title)
  const workState = useSummary ? workSummary.state : nextAction.kind.startsWith('waiting-') ? 'waiting' : 'open'
  const stateLabel = !useSummary && nextAction.kind === 'closed' ? 'Closed' : workState === 'blocked' ? 'Blocked' : workState === 'snoozed' ? 'Snoozed' : workState === 'waiting' ? 'Waiting' : 'Ready to work'
  const ownerLabel = useSummary ? workSummary.owner === 'client' ? 'Client' : workSummary.owner === 'automation' ? 'Automation' : 'Firm' : workState === 'waiting' ? 'Client' : 'Firm'
  const priorityLabel = useSummary && workState === 'open' ? ['Critical', 'Must do', 'Soon', 'Planned', 'Later'][workSummary.priorityBand] : null
  const reasons = useSummary ? workSummary.priorityReasons.map(reason => reason.label).filter(label => label !== stateLabel) : []
  const primaryLabel = useSummary ? workState === 'open' ? workSummary.actionLabel : workState === 'blocked' ? 'Review blocker' : workState === 'snoozed' ? 'Review snoozed work' : 'Review status' : nextAction.cta
  const actionHref = useSummary ? workSummary.href : nextAction.href
  const dueAt = useSummary ? workSummary.dueAt : null
  const eyebrow = `Next for ${ownerLabel === 'Automation' ? 'automation' : `the ${ownerLabel.toLowerCase()}`}${dueAt ? ` · due ${SHORT_DATE.format(new Date(dueAt))}` : ''}`
  const canSnooze = Boolean(onSnooze && useSummary && workState === 'open')

  const requirements = evaluateMatterRequirements(matter, engagement, reviewFlags).filter(item => item.key !== 'matter.review_flags_resolved')
  const visibleRequirements = requirements.filter(item => !(item.key === 'matter.engagement_signed' && engagementAction) && !(item.key === 'matter.design_ready' && actionHref.includes('/admin/drafting/')))
  const showUploads = uploadCount > 0 && workSummary?.workKey !== `matter:${matter.matter_id}:review-uploads`
  const prep: PrepItem[] = [
    ...reviewFlags.map(flag => ({
      key: flag.key, label: flag.label, done: false, tag: 'Needs data', cta: 'Fix',
      href: resolveIntakeReviewTarget(flag).href(matter.matter_id),
    })),
    ...visibleRequirements.map(item => ({
      key: item.key, label: NEED_LABELS[item.key] ?? item.label, done: item.satisfied,
      cta: item.key === 'matter.engagement_signed' ? 'Review agreement' : 'Review',
      href: item.key === 'matter.engagement_signed' ? '?tab=billing'
        : item.key === 'matter.design_ready' ? `/admin/drafting/${matter.matter_id}?step=design`
        : item.key === 'matter.drafts_shared' ? `/admin/drafting/${matter.matter_id}?step=review`
        : '?tab=tasks',
    })),
    ...(showUploads ? [{ key: 'uploads', label: `${uploadCount} client upload${uploadCount === 1 ? '' : 's'} to review`, done: false, cta: 'Review uploads', onClick: onUploads }] : []),
    ...(unreadCount > 0 ? [{ key: 'messages', label: `${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`, done: false, cta: 'Read messages', onClick: onMessages }] : []),
  ]
  const hasOpenPrep = prep.some(item => !item.done)

  const milestone = nextMatterMilestone(matter, details)

  return <div className="@container/overview min-w-0">
  <div className="grid min-w-0 items-start gap-5 @min-[960px]/overview:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-label="Next action" className="rounded-lg border bg-card px-6 py-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-selected-border" />
          {eyebrow}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className={cn('rounded-sm font-medium', workState === 'blocked' && 'border-amber-border bg-amber-bg text-amber')}>{stateLabel}</Badge>
          {priorityLabel && <span>{priorityLabel}</span>}
          <span>· Owner: {ownerLabel}</span>
          {reasons.length > 0 && <span>· {reasons.join(' · ')}</span>}
        </div>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight">{useSummary ? workSummary.title : nextAction.title}</h2>
        {!useSummary && nextAction.detail && <p className="mt-1 text-muted-foreground">{nextAction.detail}</p>}

        {hasOpenPrep && <ul aria-label="Prep checklist" className="mt-4 divide-y rounded-lg border">
          {prep.map(item => <li key={item.key} className="flex items-center gap-3 px-3.5 py-2.5">
            <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded-sm', item.done ? 'bg-success text-success-foreground' : 'border-[1.5px] border-input')}>
              {item.done && <Check className="size-2.5" strokeWidth={3} />}
            </span>
            <span className={cn('min-w-0 flex-1', item.done && 'text-muted-foreground line-through')}>
              {item.label}{item.done && <span className="sr-only"> (done)</span>}
            </span>
            {item.tag && !item.done && <Badge variant="outline" className="border-amber-border bg-amber-bg text-micro text-amber">{item.tag}</Badge>}
            {!item.done && item.cta && (item.href
              ? <Link className="shrink-0 font-medium text-primary hover:underline" href={item.href}>{item.cta}</Link>
              : <Button variant="link" className="h-auto p-0" onClick={item.onClick}>{item.cta}</Button>)}
          </li>)}
        </ul>}

        <div className="mt-4 flex flex-wrap gap-2">
          {!useSummary && engagementAction
            ? <Button onClick={onEngagement}>{nextAction.cta}<ArrowRight aria-hidden className="size-3.5" /></Button>
            : <Button asChild><Link href={actionHref}>{primaryLabel}<ArrowRight aria-hidden className="size-3.5" /></Link></Button>}
          {canSnooze && workSummary && <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline">Snooze</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => void onSnooze?.(workSummary.workKey, wakeAt(1))}>Until tomorrow</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void onSnooze?.(workSummary.workKey, wakeAt(3))}>For 3 days</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void onSnooze?.(workSummary.workKey, wakeAt(7))}>For a week</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
      </section>

      {/* Compact next-milestone line — the stage strip in the header is the
          primary timeline, so Overview no longer repeats a second track. */}
      <section aria-label="Matter milestones" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next milestone</h2>
        <p className="text-compact text-muted-foreground">
          {milestone ? <>
            <strong className="font-medium text-foreground">{milestone.label}</strong>
            {' · '}<time dateTime={milestone.date}>{formatDate(milestone.date)}</time>
            {' · '}<span className={milestone.daysAway < 0 ? 'font-medium text-destructive' : undefined}>{relativeDays(milestone.daysAway)}</span>
            {milestone.derived ? ' · Calculated from target signing' : ''}
            {' · '}
          </> : <>No milestone scheduled. </>}
          <Button variant="link" className="h-auto p-0 text-compact" onClick={onDates}>{milestone ? 'View all dates' : 'Set date'}</Button>
        </p>
      </section>

      <section aria-label="Matter communication and activity" className="overflow-hidden rounded-lg border bg-card">
        {composer && <div className="border-b">{composer}</div>}
        <div className="px-4 pb-2.5 pt-1.5">
          <div role="group" aria-label="Activity filter" className="flex flex-wrap gap-1.5 pb-1 pt-2">
            {FEED_FILTERS.map(filter => (
              <FilterChip
                key={filter}
                selected={feedFilter === filter}
                onClick={() => setFeedFilter(filter)}
              >
                {filter[0].toUpperCase() + filter.slice(1)}
              </FilterChip>
            ))}
          </div>
          {feed.length ? <ul aria-label="Recent activity">
            {feed.slice(0, ACTIVITY_PREVIEW).map(item => {
              const meta = eventMetaFor(item.event_type)
              const Icon = meta.icon
              return <li key={item.id} className="flex gap-3 border-b border-surface-2 py-2.5">
                <span role="img" aria-label={meta.label} className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
                  <Icon aria-hidden className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-3">
                    <span className="break-words font-medium">{activityEventTitle(item)}</span>
                    <time dateTime={item.created_at} className="shrink-0 whitespace-nowrap text-micro text-muted-foreground">{ACTIVITY_WHEN.format(new Date(item.created_at))}</time>
                  </div>
                  {item.detail && <p className="break-words text-compact text-muted-foreground">{item.detail}</p>}
                </div>
              </li>
            })}
          </ul> : <p className="py-6 text-sm text-muted-foreground">{activity.length === 0 ? 'No activity recorded yet.' : 'No matching activity in this preview.'}</p>}
          {activity.length > 0 && <Button variant="link" className="h-auto px-0 pt-2.5" onClick={onActivity}>View all activity</Button>}
        </div>
      </section>
    </div>

    <aside aria-label="Matter summary" className="min-w-0">
      {sidebar}
    </aside>
  </div>
  </div>
}
