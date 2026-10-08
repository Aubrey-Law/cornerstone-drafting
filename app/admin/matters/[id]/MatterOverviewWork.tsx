'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'
import type { MatterNextAction } from '@/lib/matterNextAction'
import { evaluateMatterRequirements, type EngagementState } from '@/lib/lifecycle/matter'
import { resolveIntakeReviewTarget, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { formatDate, formatDateDetail } from '@/lib/utils'
import { nextMatterMilestone } from '@/lib/matter/nextMilestone'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { PipelineMatter, MatterActivity } from '@/types/database'
import { MatterActivityTab } from './MatterActivityTab'

const NEED_LABELS: Record<string, string> = {
  'matter.design_ready': 'Approve the design sheet',
  'matter.drafts_shared': 'Share reviewed drafts with the client',
  'matter.engagement_signed': 'Engagement signature outstanding',
  'matter.signing_scheduled': 'Schedule the signing appointment',
  'matter.documents_executed': 'Record document execution',
}

export function MatterOverviewWork({ matter, nextAction, workSummary, engagement, reviewFlags, unreadCount, uploadCount, details = null, onDates, activity, onEngagement, onUploads, onMessages, onActivity, facts, composer, tasks }: {
  facts?: ReactNode
  composer?: ReactNode
  tasks?: ReactNode
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
}) {
  const [feedFilter, setFeedFilter] = useState<'all' | 'notes' | 'documents' | 'messages' | 'system'>('all')
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
  const primaryLabel = useSummary ? workState === 'open' ? workSummary.actionLabel : workState === 'blocked' ? 'Review blocker' : workState === 'snoozed' ? 'Review snoozed work' : 'Review status' : nextAction.cta
  const actionHref = useSummary ? workSummary.href : nextAction.href
  const needs = evaluateMatterRequirements(matter, engagement, reviewFlags).filter(item => !item.satisfied && item.key !== 'matter.review_flags_resolved')
  const milestone = nextMatterMilestone(matter, details)
  const visibleNeeds = needs.filter(item => !(item.key === 'matter.engagement_signed' && engagementAction) && !(item.key === 'matter.design_ready' && actionHref.includes('/admin/drafting/')))
  const showUploads = uploadCount > 0 && workSummary?.workKey !== `matter:${matter.matter_id}:review-uploads`
  const hasAttention = reviewFlags.length > 0 || visibleNeeds.length > 0 || unreadCount > 0 || showUploads
  return <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="order-2 flex min-w-0 flex-col gap-5 xl:order-first">
      {facts && <div className="order-2 xl:order-1">{facts}</div>}
      {composer && <div className="order-1 xl:order-2">{composer}</div>}
      <section aria-label="Matter activity" className="order-3 rounded-lg border bg-card p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Activity filter" className="flex flex-wrap gap-2">
            {(['all', 'messages', 'notes', 'documents', 'system'] as const).map(filter => <Button key={filter} size="sm" variant={feedFilter === filter ? 'default' : 'outline'} aria-pressed={feedFilter === filter} className="h-7 rounded-full px-3 text-xs" onClick={() => setFeedFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</Button>)}
          </div>
          <Button variant="link" size="sm" onClick={onActivity}>View all activity</Button>
        </div>
        {feed.length ? <MatterActivityTab activity={feed.slice(0, 8)} loading={false} /> : <p className="py-6 text-sm text-muted-foreground">{feedFilter === 'all' ? 'No activity recorded yet.' : 'No matching activity in this preview. Open all activity to explore the full history.'}</p>}
      </section>
    </div>
    <aside aria-label="Up next" className="contents xl:order-last xl:block xl:space-y-6 xl:border-l xl:bg-card xl:p-5">
      <div className="order-first space-y-3 rounded-lg border bg-card p-4 xl:border-0 xl:bg-transparent xl:p-0">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next</h2>
      <section aria-label="Next action" className="rounded-lg bg-primary p-4 text-primary-foreground">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-current/30 px-2 py-1 font-medium">{stateLabel}</span>
          {priorityLabel && <span>{priorityLabel}</span>}
        </div>
        <p className="mb-2 text-xs opacity-80">Owner: {ownerLabel}</p>
        <h3 className="text-base font-semibold">{useSummary ? workSummary.title : nextAction.title}</h3>
        <p className="mt-2 text-xs leading-relaxed opacity-80">{useSummary ? workSummary.priorityReasons.map(reason => reason.label).join(' · ') : nextAction.detail}</p>
        {useSummary && workSummary.dueAt && <p className="mt-3 border-t border-current/20 pt-3 text-sm"><span className="opacity-80">Due </span><time dateTime={workSummary.dueAt}>{formatDateDetail(workSummary.dueAt)}</time></p>}
        <div className="mt-4">{!useSummary && engagementAction ? <Button variant="secondary" size="sm" onClick={onEngagement}>{nextAction.cta}</Button> : <Button variant="secondary" size="sm" asChild><Link href={actionHref}>{primaryLabel}</Link></Button>}</div>
      </section>
      </div>
      <div className="order-3 space-y-5 rounded-lg border bg-card p-4 xl:border-0 xl:bg-transparent xl:p-0">
    {hasAttention && <section aria-labelledby="matter-attention-title">
      <h2 id="matter-attention-title" className="text-sm font-semibold">Needs attention <span className="ml-1 text-xs font-normal text-muted-foreground">{reviewFlags.length + visibleNeeds.length + (showUploads ? 1 : 0) + (unreadCount > 0 ? 1 : 0)}</span></h2>
      <ul className="mt-3 divide-y">
        {reviewFlags.map(flag => <li key={flag.key} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{flag.label}</span><Link className="shrink-0 text-primary underline underline-offset-4" href={resolveIntakeReviewTarget(flag).href(matter.matter_id)}>Review</Link></li>)}
        {visibleNeeds.map(item => <li key={item.key} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{NEED_LABELS[item.key] ?? item.label}<span className="mt-1 block text-xs text-muted-foreground">{item.owner === 'client' ? 'Waiting on client' : item.owner === 'attorney' ? 'Attorney' : 'Firm'}</span></span>{item.key === 'matter.engagement_signed' ? <Link className="shrink-0 text-primary underline underline-offset-4" href="?tab=billing">Review agreement</Link> : <Link className="shrink-0 text-primary underline underline-offset-4" href={item.key === 'matter.design_ready' ? `/admin/drafting/${matter.matter_id}?step=design` : item.key === 'matter.drafts_shared' ? `/admin/drafting/${matter.matter_id}?step=review` : `?tab=tasks`}>Review</Link>}</li>)}
        {showUploads && <li className="flex items-center justify-between gap-4 py-3 text-sm"><span>{uploadCount} client upload{uploadCount === 1 ? '' : 's'} to review</span><Button variant="link" onClick={onUploads}>Review uploads</Button></li>}
        {unreadCount > 0 && <li className="flex items-center justify-between gap-4 py-3 text-sm"><span>{unreadCount} unread message{unreadCount === 1 ? '' : 's'}</span><Button variant="link" onClick={onMessages}>Read messages</Button></li>}
      </ul>
    </section>}
    <section aria-labelledby="matter-upcoming-title">
      <h2 id="matter-upcoming-title" className="text-sm font-semibold">Next milestone</h2>
      {milestone ? <div className="mt-3 space-y-1">
        <p className="text-sm font-medium">{milestone.label}</p>
        <p className="text-sm"><time dateTime={milestone.date}>{formatDate(milestone.date)}</time></p>
        <p className={milestone.daysAway < 0 ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'}>
          {milestone.daysAway < 0 ? `${Math.abs(milestone.daysAway)} day${milestone.daysAway === -1 ? '' : 's'} overdue` : milestone.daysAway === 0 ? 'Today' : `In ${milestone.daysAway} day${milestone.daysAway === 1 ? '' : 's'}`}
        </p>
        {milestone.derived && <p className="text-xs text-muted-foreground">Calculated from target signing</p>}
      </div> : <p className="mt-2 text-sm text-muted-foreground">No milestone scheduled.</p>}
      <Button variant="link" size="sm" className="mt-2 h-auto p-0" onClick={onDates}>{milestone ? 'View all dates' : 'Set date'}</Button>
    </section>
    {tasks && <section className="border-t pt-5">{tasks}</section>}
      </div>
    </aside>
  </div>
}
