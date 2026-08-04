'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
import { ManualEmailComposer } from '@/components/rail/RailEmailPane'
import { MAX_LEAD_SMS_BODY_LENGTH, MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'

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

const ROUTE_SEGMENT: Record<CommunicationTarget['type'], string> = {
  lead: 'leads',
  matter: 'matters',
  contact: 'contacts',
}

const TITLE: Record<CommunicationTarget['type'], { email: string; sms: string }> = {
  lead: { email: 'Email lead', sms: 'Text lead' },
  matter: { email: 'Email client', sms: 'Text client' },
  contact: { email: 'Email contact', sms: 'Text contact' },
}

/**
 * Email or text any record, with AI drafting on both channels. Generalized
 * from the lead-only dialog so matters and contacts get the same composer
 * rather than three near-copies.
 */
export function CommunicationDialog({
  open,
  channel,
  target,
  recipientName,
  recipientEmail = null,
  recipientPhone = null,
  token,
  onOpenChange,
  onSent,
  templateCategories,
  variableValues,
  initialMessage,
}: CommunicationDialogProps) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Matters allow a full-length SMS; leads and one-off contacts are held to
  // the shorter single-segment limit, matching CommunicationThread.
  const maxChars = target.type === 'matter' ? MAX_SMS_BODY_LENGTH : MAX_LEAD_SMS_BODY_LENGTH
  const base = `/api/admin/${ROUTE_SEGMENT[target.type]}/${target.id}`
  const firstName = recipientName.trim().split(/\s+/)[0] || 'contact'

  useEffect(() => {
    if (!open) {
      setMessage('')
      setError(null)
    } else if (channel === 'sms' && initialMessage) {
      setMessage(initialMessage.slice(0, maxChars))
    }
  }, [channel, initialMessage, open, maxChars])

  async function send() {
    if (!token) return
    if (message.length > maxChars) {
      setError(`Message must be ${maxChars} characters or fewer`)
      return
    }
    setSending(true)
    setError(null)
    try {
      const payload = target.type === 'matter'
        ? { recipient: target.recipient ?? 'client', body: message.trim() }
        : { body: message.trim() }
      const response = await fetch(`${base}/send-sms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Could not send text')
      await onSent()
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

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

  const ready = Boolean(message.trim()) && message.length <= maxChars

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{TITLE[target.type].sms}</DialogTitle>
          <DialogDescription>
            {[recipientPhone, recipientName].filter(Boolean).join(' · ')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="communication-dialog-body">Text message</Label>
            <Textarea
              id="communication-dialog-body"
              className="min-h-40"
              maxLength={maxChars}
              placeholder={`Write to ${firstName}, or let AI draft it…`}
              value={message}
              onChange={event => setMessage(event.target.value.slice(0, maxChars))}
            />
            <p className="text-right text-xs text-muted-foreground">{message.length}/{maxChars}</p>
            <DraftWithAiButton
              apiPath={`${base}/draft-reply`}
              channel="sms"
              notes={message}
              maxChars={maxChars}
              onDraft={next => setMessage(next.slice(0, maxChars))}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button onClick={() => void send()} disabled={sending || !ready}>
            {sending ? 'Sending…' : 'Send text'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
