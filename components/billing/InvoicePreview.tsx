import { moneyExact } from '@/app/admin/billing/financeFormat'
import type { InvoiceLine } from '@/lib/billing/invoices'
import { cn } from '@/lib/utils'

/**
 * The invoice as the client will see it.
 *
 * Rendered as JSX rather than by injecting the email HTML, so a client-supplied
 * charge description can never become markup. The email body in
 * lib/invoices/emailBody.ts renders the same view model, so the two agree on
 * every number while each stays safe in its own medium.
 */
export interface InvoicePreviewData {
  firmName: string
  remitTo: string
  billToName: string
  billToEmail: string | null
  matterNumber: string | null
  number: string | null
  issueDate: string | null
  dueDate: string | null
  lines: Pick<InvoiceLine, 'description' | 'amountCents'>[]
  subtotalCents: number
  collectedCents: number
  notes: string | null
  terms: string | null
  paymentLink: string | null
}

function displayDate(key: string | null): string {
  if (!key) return '—'
  const parsed = new Date(`${key}T12:00:00`)
  return Number.isNaN(parsed.valueOf())
    ? key
    : new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(parsed)
}

export function InvoicePreview({
  data,
  className,
}: {
  data: InvoicePreviewData
  className?: string
}) {
  const balance = Math.max(0, data.subtotalCents - data.collectedCents)

  return (
    <article
      aria-label="Invoice preview"
      className={cn('min-w-0 rounded-lg border border-border bg-card p-6 text-card-foreground', className)}
    >
      <header className="border-b-2 border-brand-teal pb-3">
        <p className="text-2xl font-semibold tracking-tight text-brand-navy dark:text-foreground">
          INVOICE
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{data.firmName}</p>
      </header>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-teal">Bill to</p>
          <p className="mt-1 break-words text-sm font-medium">{data.billToName}</p>
          {data.billToEmail && (
            <p className="break-words text-sm text-muted-foreground">{data.billToEmail}</p>
          )}
          {data.matterNumber && (
            <p className="text-sm text-muted-foreground">Matter {data.matterNumber}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-teal">Invoice</p>
          <dl className="mt-1 space-y-0.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Number</dt>
              <dd className="font-medium">{data.number ?? 'Not yet issued'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Issued</dt>
              <dd>{displayDate(data.issueDate)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Due</dt>
              <dd className="font-medium">{displayDate(data.dueDate)}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <caption className="sr-only">Invoice line items</caption>
          <thead>
            <tr className="border-b-2 border-brand-navy dark:border-border">
              <th scope="col" className="py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-brand-navy dark:text-foreground">
                Description
              </th>
              <th scope="col" className="py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-brand-navy dark:text-foreground">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                  Choose at least one charge to bill.
                </td>
              </tr>
            ) : data.lines.map((line, index) => (
              <tr key={`${line.description}-${index}`} className="border-b border-border">
                <td className="py-2 pr-3">{line.description}</td>
                <td className="py-2 text-right tabular-nums">{moneyExact(line.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-2 text-right text-muted-foreground">Subtotal</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {moneyExact(data.subtotalCents)}
              </td>
            </tr>
            {data.collectedCents > 0 && (
              <tr>
                <td className="py-1 text-right text-muted-foreground">Payments applied</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  − {moneyExact(data.collectedCents)}
                </td>
              </tr>
            )}
            <tr className="border-t-2 border-brand-navy dark:border-border">
              <td className="pt-2 text-right text-base font-semibold">Balance due</td>
              <td className="pt-2 text-right text-base font-semibold tabular-nums">
                {moneyExact(balance)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.paymentLink && (
        <p className="mt-5 rounded-md border border-brand-teal/30 bg-green-bg px-3 py-2 text-sm">
          Pay online:{' '}
          <span className="break-all font-medium">{data.paymentLink}</span>
        </p>
      )}

      {data.notes && (
        <section className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-brand-teal">Notes</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{data.notes}</p>
        </section>
      )}

      {data.terms && (
        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-brand-teal">
            Payment terms
          </h3>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{data.terms}</p>
        </section>
      )}

      <footer className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
        {data.remitTo}
      </footer>
    </article>
  )
}
