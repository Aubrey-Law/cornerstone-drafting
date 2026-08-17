'use client'

import { useState } from 'react'
import { Download, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getDocumentUrl } from '@/lib/documents'
import type { PortalAccount } from '@/lib/queries/portal'

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function displayDate(key: string | null): string {
  if (!key) return '—'
  const parsed = new Date(`${key}T12:00:00Z`)
  return Number.isNaN(parsed.valueOf()) ? key : DATE.format(parsed)
}

/**
 * What the client owes and the invoices behind it.
 *
 * Downloads go through the shared documents route rather than a portal-only
 * path: an invoice PDF is stored as a shared matter document, and that route
 * already enforces "shared, and on a matter you can access". One access rule
 * is easier to keep correct than two.
 */
export function PortalAccountCard({ account }: { account: PortalAccount }) {
  const [pending, setPending] = useState<string | null>(null)
  const recent = account.invoices.slice(0, 3)

  async function download(invoice: PortalAccount['invoices'][number]) {
    if (!invoice.documentId) return
    setPending(invoice.id)
    try {
      const url = await getDocumentUrl(invoice.documentId, 'download')
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `Invoice ${invoice.number}.pdf`
      anchor.rel = 'noopener noreferrer'
      anchor.click()
    } catch {
      toast.error('Could not open that invoice')
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">Your account</h2>

      {account.balanceCents > 0 ? (
        <>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {MONEY.format(account.balanceCents / 100)}
          </p>
          <p className="text-xs text-muted-foreground">
            {account.nextDueDate
              ? `Due ${displayDate(account.nextDueDate)}`
              : 'Balance outstanding'}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Your balance is paid in full. Thank you.
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {recent.map(invoice => (
          <li key={invoice.id} className="flex items-start gap-2.5">
            <ReceiptText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">
                Invoice {invoice.number}
                {invoice.paid && <span className="ml-2 text-xs text-green">Paid</span>}
                {invoice.overdue && (
                  <span className="ml-2 text-xs font-medium text-destructive">Past due</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {MONEY.format(invoice.subtotalCents / 100)}
                {invoice.balanceCents > 0 && invoice.balanceCents !== invoice.subtotalCents
                  && ` · ${MONEY.format(invoice.balanceCents / 100)} outstanding`}
                {invoice.dueDate && ` · due ${displayDate(invoice.dueDate)}`}
              </p>
            </div>
            {invoice.documentId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 shrink-0"
                disabled={pending === invoice.id}
                onClick={() => void download(invoice)}
              >
                <Download className="size-4" aria-hidden />
                <span className="sr-only">Download invoice {invoice.number}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>

      {account.invoices.some(invoice => invoice.paymentLink && invoice.balanceCents > 0) && (
        <Button asChild className="mt-4 min-h-11 w-full">
          <a
            href={account.invoices.find(i => i.paymentLink && i.balanceCents > 0)!.paymentLink!}
            rel="noopener noreferrer"
          >
            Pay online
          </a>
        </Button>
      )}
    </section>
  )
}
