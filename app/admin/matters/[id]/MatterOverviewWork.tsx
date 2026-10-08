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
  const attentionCount = reviewFlags.length + visibleNeeds.length + (showUploads ? 1 : 0) + (unreadCount > 0 ? 1 : 0)
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-label="Matter focus brief" className="rounded-lg border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-selected-border" />
          Focus brief
        </div>
        <section aria-label="Next action" className="mt-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded border border-border bg-muted px-2 py-1 font-medium text-foreground">{stateLabel}</span>
            {priorityLabel && <span>{priorityLabel}</span>}
            <span>Owner: {ownerLabel}</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">{useSummary ? workSummary.title : nextAction.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{useSummary ? workSummary.priorityReasons.map(reason => reason.label).join(' · ') : nextAction.detail}</p>
          {useSummary && workSummary.dueAt && <p className="mt-3 text-sm"><span className="text-muted-foreground">Due </span><time dateTime={workSummary.dueAt}>{formatDateDetail(workSummary.dueAt)}</time></p>}
          <div className="mt-4">{!useSummary && engagementAction ? <Button size="sm" onClick={onEngagement}>{nextAction.cta}</Button> : <Button size="sm" asChild><Link href={actionHref}>{primaryLabel}</Link></Button>}</div>
        </section>

        {hasAttention && <section aria-labelledby="matter-attention-title" className="mt-5 border-t pt-4">
          <h2 id="matter-attention-title" className="text-sm font-semibold">Needs attention <span className="ml-1 text-xs font-normal text-muted-foreground">{attentionCount}</span></h2>
          <ul className="mt-2 divide-y">
            {reviewFlags.map(flag => <li key={flag.key} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{flag.label}</span><Link className="shrink-0 font-medium text-primary hover:underline" href={resolveIntakeReviewTarget(flag).href(matter.matter_id)}>Review</Link></li>)}
            {visibleNeeds.map(item => <li key={item.key} className="flex items-center justify-between gap-4 py-3 text-sm"><span>{NEED_LABELS[item.key] ?? item.label}<span className="mt-1 block text-xs text-muted-foreground">{item.owner === 'client' ? 'Waiting on client' : item.owner === 'attorney' ? 'Attorney' : 'Firm'}</span></span>{item.key === 'matter.engagement_signed' ? <Link className="shrink-0 font-medium text-primary hover:underline" href="?tab=billing">Review agreement</Link> : <Link className="shrink-0 font-medium text-primary hover:underline" href={item.key === 'matter.design_ready' ? `/admin/drafting/${matter.matter_id}?step=design` : item.key === 'matter.drafts_shared' ? `/admin/drafting/${matter.matter_id}?step=review` : `?tab=tasks`}>Review</Link>}</li>)}
            {showUploads && <li className="flex items-center justify-between gap-4 py-3 text-sm"><span>{uploadCount} client upload{uploadCount === 1 ? '' : 's'} to review</span><Button variant="link" onClick={onUploads}>Review uploads</Button></li>}
            {unreadCount > 0 && <li className="flex items-center justify-between gap-4 py-3 text-sm"><span>{unreadCount} unread message{unreadCount === 1 ? '' : 's'}</span><Button variant="link" onClick={onMessages}>Read messages</Button></li>}
          </ul>
        </section>}
      </section>

      <section aria-label="Matter milestones" className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Milestones</h2>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onDates}>{milestone ? 'View all dates' : 'Set date'}</Button>
        </div>
        {milestone ? <div className="mt-4 flex items-start gap-3">
          <span aria-hidden className="mt-1 size-3 shrink-0 rounded-full border-2 border-selected-border bg-card" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{milestone.label}</p>
            <p className="mt-1 text-sm"><time dateTime={milestone.date}>{formatDate(milestone.date)}</time></p>
            <p className={milestone.daysAway < 0 ? 'mt-1 text-sm font-medium text-destructive' : 'mt-1 text-sm text-muted-foreground'}>
              {milestone.daysAway < 0 ? `${Math.abs(milestone.daysAway)} day${milestone.daysAway === -1 ? '' : 's'} overdue` : milestone.daysAway === 0 ? 'Today' : `In ${milestone.daysAway} day${milestone.daysAway === 1 ? '' : 's'}`}
              {milestone.derived ? ' · calculated from target signing' : ''}
            </p>
          </div>
        </div> : <p className="mt-3 text-sm text-muted-foreground">No milestone scheduled.</p>}
      </section>

      <section aria-label="Matter communication and activity" className="space-y-5">
        {composer}
        <section aria-label="Matter activity" className="rounded-lg border bg-card p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <Button variant="link" size="sm" onClick={onActivity}>View all activity</Button>
          </div>
          <div role="group" aria-label="Activity filter" className="mb-4 flex flex-wrap gap-2">
            {(['all', 'messages', 'notes', 'documents', 'system'] as const).map(filter => <Button key={filter} size="sm" variant={feedFilter === filter ? 'secondary' : 'outline'} aria-pressed={feedFilter === filter} className="h-7 rounded-full px-3 text-xs" onClick={() => setFeedFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</Button>)}
          </div>
          {feed.length ? <MatterActivityTab activity={feed.slice(0, 8)} loading={false} /> : <p className="py-6 text-sm text-muted-foreground">{feedFilter === 'all' ? 'No activity recorded yet.' : 'No matching activity in this preview. Open all activity to explore the full history.'}</p>}
        </section>
      </section>
    </div>

    <aside aria-label="Matter summary" className="space-y-4">
      {facts}
      {tasks && <section className="rounded-lg border bg-card p-4">{tasks}</section>}
    </aside>
  </div>
}
