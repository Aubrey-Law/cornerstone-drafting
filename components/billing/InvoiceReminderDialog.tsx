'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Bell, FileText, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { InvoiceDetail } from '@/lib/billing/invoices'
import { formatFirmDateTime } from '@/lib/format'

export type InvoiceReminderTone = 'friendly' | 'firm' | 'final'

const toneLabels: Record<InvoiceReminderTone, string> = {
  friendly: 'Friendly',
  firm: 'Firm',
  final: 'Final',
}

const reminderCopy: Record<InvoiceReminderTone, string> = {
  friendly:
    'A quick reminder that this invoice is now due. If payment has already been sent, the client can disregard the note.',
  firm:
    'The invoice is past due. The client is asked to pay promptly or let the firm know when payment can be expected.',
  final:
    'The invoice remains unpaid and is significantly past due. The client is asked to arrange payment or contact the firm.',
}

export function recommendedReminderTone(daysPastDue: number): InvoiceReminderTone {
  return daysPastDue > 45 ? 'final' : daysPastDue > 14 ? 'firm' : 'friendly'
}

/** Review gate for an external billing communication. Nothing sends until confirmed here. */
export function InvoiceReminderDialog({
  open,
  onOpenChange,
  invoice,
  sending,
  returnFocusRef,
  onSend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoiceDetail
  sending: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onSend: (tone: InvoiceReminderTone) => Promise<void>
}) {
  const [tone, setTone] = useState<InvoiceReminderTone>(() =>
    recommendedReminderTone(invoice.daysPastDue),
  )
  const recipient = invoice.billToEmail ?? invoice.clientEmail

  useEffect(() => {
    if (open) setTone(recommendedReminderTone(invoice.daysPastDue))
  }, [invoice.daysPastDue, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Review payment reminder</DialogTitle>
          <DialogDescription>
            Confirm the recipient and tone before sending invoice {invoice.number}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3 rounded-lg border border-border bg-muted p-3 text-sm">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Recipient</p>
                <p className="break-all font-medium">{recipient ?? 'No email address on file'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="font-medium">
                  {invoice.pdfDocumentId ? 'Invoice PDF attached' : 'Invoice document attached'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Balance and due date are included in the email.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-reminder-tone">Tone</Label>
            <Select value={tone} onValueChange={value => setTone(value as InvoiceReminderTone)}>
              <SelectTrigger id="invoice-reminder-tone" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(toneLabels) as InvoiceReminderTone[]).map(value => (
                  <SelectItem key={value} value={value}>{toneLabels[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-border px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bell className="size-4 text-muted-foreground" aria-hidden />
              {toneLabels[tone]} reminder
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{reminderCopy[tone]}</p>
          </div>

          {invoice.lastRemindedAt && (
            <p className="text-xs text-muted-foreground">
              Last reminder sent {formatFirmDateTime(invoice.lastRemindedAt)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSend(tone)} disabled={sending || !recipient}>
            <Bell className="size-4" aria-hidden />
            {sending ? 'Sending…' : 'Send reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
