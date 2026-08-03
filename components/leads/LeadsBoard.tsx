'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { LeadActionsMenu } from '@/components/leads/LeadActionsMenu'
import { needsAttention } from '@/components/leads/LeadPipelineInsights'
import { leadListName, nextStep, provisionalLeadNumber } from '@/components/leads/LeadsTable'
import {
  groupLeadsByBoardColumn,
  LEAD_BOARD_COLUMNS,
  leadBoardColumn,
  resolveBoardDrop,
  type LeadBoardColumnKey,
} from '@/lib/leads/board'
import { formatCurrency } from '@/lib/format'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { cn } from '@/lib/utils'
import type { LeadListRow } from '@/lib/leads/viewTypes'

const DRAG_TYPE = 'text/lead-id'

interface LeadsBoardProps {
  leads: LeadListRow[]
  hasAnyLeads: boolean
  busyLeadId: string | null
  esignEnabled: boolean
  /** Card whose record side panel is open. */
  activeLeadId?: string | null
  onActivate: (lead: LeadListRow) => void
  openMenuLeadId?: string | null
  onMenuOpenChange?: (leadId: string, open: boolean) => void
  onEdit: (lead: LeadListRow) => void
  onSendIntake: (lead: LeadListRow) => void
  onSendEngagement: (lead: LeadListRow) => void
  onHire: (lead: LeadListRow) => void
  onArchive: (lead: LeadListRow) => void
  onMarkLost: (lead: LeadListRow) => void
  onMarkDeclined: (lead: LeadListRow) => void
  onReopen: (lead: LeadListRow) => void
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000))
}

/** Short state word for the column the card currently sits in. */
function stateChip(lead: LeadListRow): { label: string; tone: 'done' | 'pending' | 'muted' } | null {
  const column = leadBoardColumn(lead)
  if (column === 'intake_sent') {
    const days = daysSince(lead.intake_sent_at)
    return { label: days === null ? 'Sent' : `Sent ${days}d`, tone: 'pending' }
  }
  if (column === 'engagement') {
    if (lead.engagement_status === 'signed') return { label: 'Signed', tone: 'done' }
    if (lead.engagement_status === 'declined') return { label: 'Declined', tone: 'pending' }
    const days = daysSince(lead.engagement_sent_at)
    return { label: days === null ? 'Sent' : `Sent ${days}d`, tone: 'pending' }
  }
  if (column === 'intake_complete') return { label: 'Intake complete', tone: 'done' }
  if (column === 'hired') return { label: 'Hired', tone: 'done' }
  if (column === 'lost') return { label: 'Lost', tone: 'muted' }
  if (column === 'declined') return { label: 'Declined', tone: 'muted' }
  return null
}

const CHIP_TONE: Record<'done' | 'pending' | 'muted', string> = {
  done: 'bg-green-bg text-green',
  pending: 'bg-amber-bg text-amber',
  muted: 'bg-muted text-muted-foreground',
}

export function LeadsBoard({
  leads,
  hasAnyLeads,
  busyLeadId,
  esignEnabled,
  activeLeadId = null,
  onActivate,
  openMenuLeadId = null,
  onMenuOpenChange,
  onEdit,
  onSendIntake,
  onSendEngagement,
  onHire,
  onArchive,
  onMarkLost,
  onMarkDeclined,
  onReopen,
}: LeadsBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<LeadBoardColumnKey | null>(null)

  const byColumn = useMemo(() => groupLeadsByBoardColumn(leads), [leads])

  function handleDrop(target: LeadBoardColumnKey, leadId: string) {
    const lead = leads.find(candidate => candidate.id === leadId)
    if (!lead) return
    const drop = resolveBoardDrop(lead, target)
    if (drop.kind === 'none') {
      if (drop.reason) toast.error(drop.reason)
      return
    }
    if (drop.kind === 'send_intake') onSendIntake(lead)
    else if (drop.kind === 'send_engagement') onSendEngagement(lead)
    else if (drop.kind === 'hire') onHire(lead)
    else if (drop.kind === 'mark_lost') onMarkLost(lead)
    else if (drop.kind === 'mark_declined') onMarkDeclined(lead)
    else onReopen(lead)
  }

  if (leads.length === 0) {
    return (
      <EmptyState
        icon={UserPlus}
        title={hasAnyLeads ? 'No leads in this view' : 'No leads yet'}
        description={hasAnyLeads ? undefined : 'Add one to send the intake and engagement agreement.'}
        className="rounded-lg border border-border bg-card"
      />
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {LEAD_BOARD_COLUMNS.map(column => {
        const items = byColumn.get(column.key) ?? []
        const isTarget = dropTarget === column.key

        return (
          <section
            key={column.key}
            aria-label={column.label}
            className={cn(
              'flex min-w-[15rem] flex-1 flex-col rounded-lg border bg-muted/20',
              isTarget ? 'border-primary ring-2 ring-primary/20' : 'border-border',
            )}
            onDragOver={event => {
              event.preventDefault()
              setDropTarget(column.key)
            }}
            onDragLeave={() => setDropTarget(current => (current === column.key ? null : current))}
            onDrop={event => {
              event.preventDefault()
              setDropTarget(null)
              const leadId = event.dataTransfer.getData(DRAG_TYPE)
              if (leadId) handleDrop(column.key, leadId)
            }}
          >
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="truncate text-xs font-semibold">{column.label}</h2>
              <span className="shrink-0 rounded-full border border-border bg-card px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </header>
            <ul className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2">
              {items.length === 0 ? (
                <li className="rounded-md border border-dashed border-border px-2 py-6 text-center text-[11px] text-muted-foreground">
                  {column.hint}
                </li>
              ) : (
                items.map(lead => (
                  <BoardCard
                    key={lead.id}
                    lead={lead}
                    active={activeLeadId === lead.id}
                    busy={busyLeadId === lead.id}
                    dragging={draggingId === lead.id}
                    esignEnabled={esignEnabled}
                    menuOpen={openMenuLeadId === lead.id}
                    onMenuOpenChange={onMenuOpenChange}
                    onActivate={onActivate}
                    onEdit={onEdit}
                    onSendIntake={onSendIntake}
                    onSendEngagement={onSendEngagement}
                    onHire={onHire}
                    onArchive={onArchive}
                    onDragStart={() => setDraggingId(lead.id)}
                    onDragEnd={() => setDraggingId(null)}
                  />
                ))
              )}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({
  lead,
  active,
  busy,
  dragging,
  esignEnabled,
  menuOpen,
  onMenuOpenChange,
  onActivate,
  onEdit,
  onSendIntake,
  onSendEngagement,
  onHire,
  onArchive,
  onDragStart,
  onDragEnd,
}: {
  lead: LeadListRow
  active: boolean
  busy: boolean
  dragging: boolean
  esignEnabled: boolean
  menuOpen: boolean
  onMenuOpenChange?: (leadId: string, open: boolean) => void
  onActivate: (lead: LeadListRow) => void
  onEdit: (lead: LeadListRow) => void
  onSendIntake: (lead: LeadListRow) => void
  onSendEngagement: (lead: LeadListRow) => void
  onHire: (lead: LeadListRow) => void
  onArchive: (lead: LeadListRow) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const step = nextStep(lead, esignEnabled)
  const chip = stateChip(lead)
  const attention = lead.lead_status === 'lead' && needsAttention(lead)
  const fee = formatCurrency(lead.engagement_fee_quoted)
  const runStep = () => {
    if (step.key === 'send_intake' || step.key === 'remind_intake') onSendIntake(lead)
    else if (step.key === 'send_engagement' || step.key === 'resend_engagement') onSendEngagement(lead)
    else onHire(lead)
  }

  return (
    <li>
      <article
        draggable
        onDragStart={event => {
          event.dataTransfer.setData(DRAG_TYPE, lead.id)
          event.dataTransfer.effectAllowed = 'move'
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        className={cn(
          'rounded-md border bg-card p-2.5 shadow-sm transition-opacity',
          dragging && 'opacity-50',
          busy && 'pointer-events-none opacity-60',
          active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40',
        )}
      >
        <div className="flex items-start justify-between gap-1">
          {/* Plain clicks open the record side panel; modified clicks keep the link. */}
          <Link
            href={`/admin/leads/${lead.id}`}
            className="min-w-0 flex-1"
            onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              onActivate(lead)
            }}
          >
            <p className="truncate text-sm font-semibold hover:underline">{leadListName(lead)}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {provisionalLeadNumber(lead)}
            </p>
          </Link>
          <LeadActionsMenu
            lead={lead}
            esignEnabled={esignEnabled}
            busy={busy}
            {...(onMenuOpenChange
              ? { open: menuOpen, onOpenChange: (open: boolean) => onMenuOpenChange(lead.id, open) }
              : {})}
            onEdit={onEdit}
            onSendIntake={onSendIntake}
            onSendEngagement={onSendEngagement}
            onHire={onHire}
            onArchive={onArchive}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chip && (
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', CHIP_TONE[chip.tone])}>
              {chip.label}
            </span>
          )}
          {attention && (
            <span className="rounded-full bg-red-bg px-2 py-0.5 text-[10px] font-medium text-red">
              Needs attention
            </span>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{practiceAreaLabel(lead.practice_area)}</span>
          {fee && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{fee}</span>
            </>
          )}
        </div>

        <div className="mt-2">
          {step.key === 'view_matter' && lead.matter_id ? (
            <Button size="sm" variant="outline" className="h-7 w-full px-2.5 text-xs" asChild>
              <Link href={`/admin/matters/${lead.matter_id}`}>{step.label}</Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant={step.primary ? 'default' : 'outline'}
              className="h-7 w-full px-2.5 text-xs"
              disabled={busy}
              onClick={runStep}
            >
              {step.label}
            </Button>
          )}
        </div>
      </article>
    </li>
  )
}
