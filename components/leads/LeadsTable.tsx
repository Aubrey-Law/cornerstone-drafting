import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { LeadActionsMenu } from '@/components/leads/LeadActionsMenu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { LeadProgress, isLeadIntakeComplete } from '@/components/leads/LeadProgress'
import { leadValueLabel, leadWaitingLabel } from '@/lib/leads/cardFacts'
import { clientNameMatterSlug } from '@/lib/matterNumber'
import { practiceAreaLabel, practiceAreaMatterCode } from '@/lib/practiceArea'
import type { LeadListRow, MutableLeadStatus } from '@/lib/leads/viewTypes'
import { LeadScoreBadge } from '@/components/leads/LeadScoreBadge'
import {
  computeLeadScore,
  leadScoreInputFromRow,
  leadScoreIsActive,
  type LeadScore,
} from '@/lib/leads/score'

export type NextStep =
  | { key: 'send_intake'; label: string; primary: true }
  | { key: 'remind_intake'; label: string; primary: false }
  | { key: 'send_engagement'; label: string; primary: true }
  | { key: 'resend_engagement'; label: string; primary: false }
  | { key: 'view_matter'; label: string; primary: false }
  | { key: 'hire_matter'; label: string; primary: false }

/** Structural subset so the lead detail record can reuse these labels. */
export type LeadIdentityFields = {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  created_at?: string | null
  practice_area?: string | null
}

export function leadListName(lead: LeadIdentityFields): string {
  return lead.full_name?.trim()
    || [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim()
    || lead.email
    || 'Lead'
}
export function provisionalLeadNumber(lead: LeadIdentityFields): string {
  const year = lead.created_at ? new Date(lead.created_at).getFullYear() : new Date().getFullYear()
  return `${year}-${practiceAreaMatterCode(lead.practice_area)}-${clientNameMatterSlug(leadListName(lead))}`
}

export function nextStep(lead: LeadListRow, esignEnabled: boolean): NextStep {
  if (lead.lead_status === 'hired' && lead.matter_id) {
    return { key: 'view_matter', label: 'View matter', primary: false }
  }
  if (!lead.intake_sent_at && !isLeadIntakeComplete(lead)) {
    return { key: 'send_intake', label: 'Send intake', primary: true }
  }
  if (!isLeadIntakeComplete(lead)) {
    return { key: 'remind_intake', label: 'Remind client', primary: false }
  }
  if (esignEnabled && lead.engagement_status !== 'signed') {
    return lead.engagement_sent_at
      ? { key: 'resend_engagement', label: 'Resend engagement', primary: false }
      : { key: 'send_engagement', label: 'Send engagement', primary: true }
  }
  return { key: 'hire_matter', label: 'Hire matter', primary: false }
}

/**
 * The list decorates rows with their score so sorting and rendering agree on
 * one computation. Narrower callers may omit it, and the cell computes its own.
 */
export type ScorableLeadRow = LeadListRow & { scoreDetail?: LeadScore }

interface LeadsTableProps {
  leads: ScorableLeadRow[]
  hasAnyLeads: boolean
  selected: Record<string, boolean>
  allSelected: boolean
  busyLeadId: string | null
  esignEnabled: boolean
  /** Row whose record side panel is open. */
  activeLeadId?: string | null
  onActivate?: (lead: LeadListRow) => void
  openMenuLeadId?: string | null
  onMenuOpenChange?: (leadId: string, open: boolean) => void
  onToggleAll: (selected: boolean) => void
  onToggleSelected: (leadId: string, selected: boolean) => void
  onEdit: (lead: LeadListRow) => void
  onStatusChange: (lead: LeadListRow, status: MutableLeadStatus) => void
  onSendIntake: (lead: LeadListRow) => void
  onSendEngagement: (lead: LeadListRow) => void
  onHire: (lead: LeadListRow) => void
  onArchive: (lead: LeadListRow) => void
}

export function LeadsTable({
  leads,
  hasAnyLeads,
  selected,
  allSelected,
  busyLeadId,
  esignEnabled,
  activeLeadId = null,
  onActivate,
  openMenuLeadId = null,
  onMenuOpenChange,
  onToggleAll,
  onToggleSelected,
  onEdit,
  onStatusChange,
  onSendIntake,
  onSendEngagement,
  onHire,
  onArchive,
}: LeadsTableProps) {
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
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={checked => onToggleAll(checked === true)}
                aria-label="Select all visible leads"
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Practice</TableHead>
            <TableHead>Fee / plan</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead className="text-right">Next step</TableHead>
            <TableHead className="w-10" aria-label="More actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map(lead => {
            const busy = busyLeadId === lead.id
            const step = nextStep(lead, esignEnabled)
            const runStep = () => {
              if (step.key === 'send_intake' || step.key === 'remind_intake') onSendIntake(lead)
              else if (step.key === 'send_engagement' || step.key === 'resend_engagement') onSendEngagement(lead)
              else onHire(lead)
            }

            return (
              <TableRow key={lead.id} data-active={activeLeadId === lead.id || undefined} className={activeLeadId === lead.id ? 'bg-muted/60' : undefined}>
                <TableCell>
                  <Checkbox
                    checked={Boolean(selected[lead.id])}
                    onCheckedChange={checked => onToggleSelected(lead.id, checked === true)}
                    aria-label={`Select ${leadListName(lead)}`}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {/* Plain clicks open the record side panel; modified clicks keep the link. */}
                  <Link
                    href={`/admin/crm/opportunities/${lead.id}`}
                    className="hover:underline"
                    onClick={event => {
                      if (!onActivate || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                      event.preventDefault()
                      onActivate(lead)
                    }}
                  >
                    {leadListName(lead)}
                  </Link>
                  <div className="text-[11px] font-normal text-muted-foreground">
                    {provisionalLeadNumber(lead)}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{lead.email}</TableCell>
                <TableCell>{practiceAreaLabel(lead.practice_area)}</TableCell>
                {/*
                  A quoted fee where there is one — there was exactly one
                  across 35 open leads — else the plan that will carry it,
                  which is recorded far earlier and on 13 of them.
                */}
                <TableCell>{leadValueLabel(lead) ?? '—'}</TableCell>
                <TableCell>
                  <LeadScoreBadge
                    score={lead.scoreDetail ?? computeLeadScore(leadScoreInputFromRow(lead))}
                    muted={!leadScoreIsActive(lead.lead_status)}
                    showLabel={false}
                  />
                </TableCell>
                <TableCell>
                  <LeadProgress lead={lead} />
                  {/* How long it has been waiting, or when its meeting is. */}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{leadWaitingLabel(lead)}</p>
                </TableCell>
                <TableCell className="text-right">
                  {step.key === 'view_matter' && lead.matter_id ? (
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                      <Link href={`/admin/matters/${lead.matter_id}`}>{step.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={step.primary ? 'default' : 'outline'}
                      className="h-7 px-2.5 text-xs"
                      disabled={busy}
                      onClick={runStep}
                    >
                      {step.label}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <LeadActionsMenu
                    lead={lead}
                    esignEnabled={esignEnabled}
                    busy={busy}
                    {...(onMenuOpenChange
                      ? {
                          open: openMenuLeadId === lead.id,
                          onOpenChange: (open: boolean) => onMenuOpenChange(lead.id, open),
                        }
                      : {})}
                    onEdit={onEdit}
                    onStatusChange={onStatusChange}
                    onSendIntake={onSendIntake}
                    onSendEngagement={onSendEngagement}
                    onHire={onHire}
                    onArchive={onArchive}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
