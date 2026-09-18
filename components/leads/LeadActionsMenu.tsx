import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { leadListName } from '@/components/leads/LeadsTable'
import type { LeadListRow, MutableLeadStatus } from '@/lib/leads/viewTypes'

export type LeadActionsMenuProps = {
  lead: LeadListRow
  esignEnabled: boolean
  busy: boolean
  /** Controlled so ⌘O on the record panel can open the row's menu in either view. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit: (lead: LeadListRow) => void
  onSendIntake: (lead: LeadListRow) => void
  onSendEngagement: (lead: LeadListRow) => void
  onHire: (lead: LeadListRow) => void
  onArchive: (lead: LeadListRow) => void
  /** Destroy the lead outright. Archiving keeps it; this does not. */
  onDelete: (lead: LeadListRow) => void
  onStatusChange: (lead: LeadListRow, status: MutableLeadStatus) => void
}

export function LeadActionsMenu({
  lead,
  esignEnabled,
  busy,
  open,
  onOpenChange,
  onEdit,
  onSendIntake,
  onSendEngagement,
  onHire,
  onArchive,
  onDelete,
  onStatusChange,
}: LeadActionsMenuProps) {
  const status = lead.lead_status ?? 'lead'
  const hired = status === 'hired'
  const active = status === 'lead'
  // Both closed outcomes reopen the same way, so one Reactivate covers them.
  const closed = status === 'lost' || status === 'declined'

  return (
    <DropdownMenu {...(onOpenChange ? { open: open ?? false, onOpenChange } : {})}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={busy}
          aria-label={`More actions for ${leadListName(lead)}`}
          onClick={event => event.stopPropagation()}
        >
          <MoreVertical className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onEdit(lead)}>Edit details</DropdownMenuItem>
        {!hired && (
          <DropdownMenuItem onSelect={() => onSendIntake(lead)}>
            {lead.intake_sent_at ? 'Resend intake' : 'Send intake'}
          </DropdownMenuItem>
        )}
        {!hired && esignEnabled && lead.engagement_status !== 'signed' && (
          <DropdownMenuItem onSelect={() => onSendEngagement(lead)}>
            {lead.engagement_sent_at ? 'Resend engagement' : 'Send engagement'}
          </DropdownMenuItem>
        )}
        {!hired && <DropdownMenuItem onSelect={() => onHire(lead)}>Hire matter</DropdownMenuItem>}
        {active && (
          <DropdownMenuItem onSelect={() => onStatusChange(lead, 'lost')}>Mark lost</DropdownMenuItem>
        )}
        {active && (
          <DropdownMenuItem onSelect={() => onStatusChange(lead, 'declined')}>
            Decline — not a fit
          </DropdownMenuItem>
        )}
        {closed && (
          <DropdownMenuItem onSelect={() => onStatusChange(lead, 'lead')}>Reactivate</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {!hired && (
          <DropdownMenuItem variant="destructive" onSelect={() => onArchive(lead)}>
            Archive lead
          </DropdownMenuItem>
        )}
        {/* Offered on hired leads too: the route asks for confirmation before
            destroying a client's records rather than hiding the option. */}
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(lead)}>
          Delete permanently
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
