'use client'

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'

/**
 * The record a message is addressed to. Matters text a role rather than a
 * number, mirroring `resolveMatterSmsTarget`.
 */
export type CommunicationTarget =
  | { type: 'lead'; id: string }
  | { type: 'matter'; id: string; recipient?: 'client' | 'spouse' }
  | { type: 'contact'; id: string }

interface CommunicationDialogProps {
  open: boolean
  channel: 'email' | 'sms'
  target: CommunicationTarget
  recipientName: string
  recipientEmail?: string | null
  recipientPhone?: string | null
  token: string | null
  onOpenChange: (open: boolean) => void
  onSent: () => void | Promise<void>
  /** Email-only extras, used by the lead intake-invite flow. */
  templateCategories?: string[]
  variableValues?: Record<string, string | null | undefined>
  /** Prefill for the SMS body. */
  initialMessage?: string
}

const TITLE: Record<CommunicationTarget['type'], { email: string; sms: string }> = {
  lead: { email: 'Email lead', sms: 'Text lead' },
  matter: { email: 'Email client', sms: 'Text client' },
  contact: { email: 'Email contact', sms: 'Text contact' },
}

/**
 * Shared email composer. Old text actions show retirement guidance.
 */
export function CommunicationDialog({
  open,
  channel,
  target,
  recipientName,
  recipientEmail = null,
  onOpenChange,
  onSent,
  templateCategories,
  variableValues,
}: CommunicationDialogProps) {
  if (channel === 'email') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="p-0 sm:max-w-2xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>{TITLE[target.type].email}</DialogTitle>
            <DialogDescription>
              {[recipientEmail, recipientName].filter(Boolean).join(' · ')}
            </DialogDescription>
          </DialogHeader>
          {/* A seed so the recipient shows at once — the composer fetches the
              matter's documents and extra addresses on top of it. */}
          <ManualEmailComposer
            embedded
            recordOverride={{ type: target.type, id: target.id }}
            initialContext={{
              recordType: target.type,
              recordId: target.id,
              recipientName,
              recipientEmail,
              spouseName: null,
              spouseEmail: null,
              alternateEmails: [],
              documents: [],
            }}
            templateCategories={templateCategories}
            variableValues={variableValues}
            onSent={async () => {
              await onSent()
              onOpenChange(false)
            }}
          />
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Text messaging retired</DialogTitle>
          <DialogDescription>Use your external communications service for text messages. Secure portal messaging remains available from the matter.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
