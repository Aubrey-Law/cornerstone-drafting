'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Ban, Banknote, Bell, CreditCard, Download, Send } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { InvoicePreview } from '@/components/billing/InvoicePreview'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { RecordInvoicePaymentDialog } from '@/components/billing/RecordInvoicePaymentDialog'
import { VoidInvoiceDialog } from '@/components/billing/VoidInvoiceDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { moneyExact } from '@/app/admin/billing/financeFormat'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type { InvoiceDetail } from '@/lib/billing/invoices'
import { downloadInvoiceDocument } from '@/lib/invoices/downloadInvoice'
import { formatFirmDate, formatFirmDateTime } from '@/lib/format'
import type { BillingPaymentMethod } from '@/lib/billing/types'

const methodLabels: Record<BillingPaymentMethod, string> = {
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  plan_eft: 'Plan EFT',
  cash: 'Cash',
}

export default function InvoiceDetailClient({
  invoice,
  firm,
  paymentsEnabled,
}: {
  invoice: InvoiceDetail
  firm: { name: string; remitTo: string }
  /** False when no processor is configured, which hides online payment entirely. */
  paymentsEnabled: boolean
}) {
  const router = useRouter()
  const token = useAccessToken()
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [busy, setBusy] = useState<
    'payment' | 'void' | 'send' | 'reminder' | 'checkout' | 'issue-send' | 'issue-download' | null
  >(null)
  const paymentOpenerRef = useRef<HTMLElement | null>(null)
  const voidOpenerRef = useRef<HTMLElement | null>(null)

  const isDraft = invoice.status === 'draft'
  const isVoid = invoice.status === 'void'
  const documentId = invoice.pdfDocumentId ?? invoice.docxDocumentId

  function rememberOpener(setter: (open: boolean) => void, ref: typeof paymentOpenerRef) {
    ref.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setter(true)
  }

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => ({})) as { error?: string; warning?: string }
    if (!response.ok && response.status !== 207) {
      throw new Error(json.error ?? 'Something went wrong')
    }
    return json
  }

  async function recordPayment(input: {
    amount: number
    method: BillingPaymentMethod
    note: string | null
  }) {
    setBusy('payment')
    try {
      await post(`/api/admin/billing/invoices/${invoice.id}/payments`, input)
      setPaymentOpen(false)
      toast.success(`${moneyExact(input.amount)} payment recorded`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record the payment')
    } finally {
      setBusy(null)
    }
  }

  async function voidInvoice(reason: string) {
    setBusy('void')
    try {
      await post(`/api/admin/billing/invoices/${invoice.id}/void`, { reason })
      setVoidOpen(false)
      toast.success(`Invoice ${invoice.number} voided`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not void the invoice')
    } finally {
      setBusy(null)
    }
  }

  async function resend() {
    const to = invoice.billToEmail ?? invoice.clientEmail
    if (!to) {
      toast.error('There is no email address on file for this client')
      return
    }
    setBusy('send')
    try {
      await post(`/api/admin/billing/invoices/${invoice.id}/send`, { to })
      toast.success(`Invoice ${invoice.number} sent to ${to}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the invoice')
    } finally {
      setBusy(null)
    }
  }

  async function remind() {
    setBusy('reminder')
    try {
      await post(`/api/admin/billing/invoices/${invoice.id}/reminder`, {
        tone: invoice.daysPastDue > 45 ? 'final' : invoice.daysPastDue > 14 ? 'firm' : 'friendly',
        attachInvoice: true,
      })
      toast.success('Reminder sent')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the reminder')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Issues a saved draft, optionally emailing it.
   *
   * Until this existed a draft could be created and then not acted on from its
   * own page — the only route to issuing was the composer, which you had
   * already left.
   */
  async function issue(mode: 'send' | 'download') {
    setBusy(mode === 'send' ? 'issue-send' : 'issue-download')
    try {
      const json = await post(
        `/api/admin/billing/invoices/${invoice.id}/issue`,
        { send: mode === 'send' },
      ) as {
        warning?: string
        sent?: boolean
        invoice?: {
          number: string | null
          pdfDocumentId: string | null
          docxDocumentId: string | null
        }
      }

      if (json.warning) toast.warning(json.warning)
      else if (json.sent) toast.success('Invoice issued and emailed')
      else toast.success('Invoice issued')

      if (mode === 'download') {
        const issuedDocumentId = json.invoice?.pdfDocumentId ?? json.invoice?.docxDocumentId ?? null
        if (issuedDocumentId) {
          await downloadInvoiceDocument({
            documentId: issuedDocumentId,
            invoiceNumber: json.invoice?.number ?? null,
            isPdf: Boolean(json.invoice?.pdfDocumentId),
          }).catch(() => toast.error('Invoice issued, but the download could not start'))
        } else if (!json.warning) {
          toast.warning('Invoice issued, but no document was produced to download')
        }
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not issue the invoice')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Opens a hosted checkout and stores its link on the invoice, which is what
   * puts a Pay button on the next email and in the client's portal.
   */
  async function createPayLink() {
    setBusy('checkout')
    try {
      const json = await post(`/api/admin/billing/invoices/${invoice.id}/checkout`) as
        { checkoutUrl?: string }
      toast.success(
        json.checkoutUrl
          ? 'Payment link created — it now prints on the invoice and shows in the portal'
          : 'Payment link created',
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create a payment link')
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    if (!documentId) return
    try {
      await downloadInvoiceDocument({
        documentId,
        invoiceNumber: invoice.number,
        isPdf: Boolean(invoice.pdfDocumentId),
      })
    } catch {
      toast.error('Could not fetch the invoice document')
    }
  }

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title={invoice.number ? `Invoice ${invoice.number}` : 'Draft invoice'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge invoice={invoice} overdue={invoice.overdue} />
            <Link
              href={`/admin/matters/${invoice.matterId}`}
              className="hover:text-primary hover:underline"
            >
              {invoice.clientName}
            </Link>
            {invoice.overdue && (
              <span className="font-medium text-destructive">
                {invoice.daysPastDue} days past due
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button asChild variant="ghost" className="min-h-11">
              <Link href="/admin/billing/invoices">
                <ArrowLeft className="size-4" aria-hidden />
                All invoices
              </Link>
            </Button>
            {documentId && (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void download()}>
                <Download className="size-4" aria-hidden />
                Download
              </Button>
            )}
            {isDraft && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy !== null}
                  onClick={() => void issue('download')}
                >
                  <Download className="size-4" aria-hidden />
                  {busy === 'issue-download' ? 'Issuing…' : 'Issue & download'}
                </Button>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={busy !== null}
                  onClick={() => void issue('send')}
                >
                  <Send className="size-4" aria-hidden />
                  {busy === 'issue-send' ? 'Issuing…' : 'Issue & send'}
                </Button>
              </>
            )}
            {!isDraft && !isVoid && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy !== null}
                  onClick={() => void resend()}
                >
                  <Send className="size-4" aria-hidden />
                  {busy === 'send' ? 'Sending…' : invoice.sentAt ? 'Resend' : 'Send'}
                </Button>
                {invoice.overdue && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy !== null}
                    onClick={() => void remind()}
                  >
                    <Bell className="size-4" aria-hidden />
                    {busy === 'reminder' ? 'Sending…' : 'Send reminder'}
                  </Button>
                )}
                {paymentsEnabled && invoice.balance > 0 && !invoice.paymentLink && (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy !== null}
                    onClick={() => void createPayLink()}
                  >
                    <CreditCard className="size-4" aria-hidden />
                    {busy === 'checkout' ? 'Creating…' : 'Create pay link'}
                  </Button>
                )}
                {invoice.balance > 0 && (
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() => rememberOpener(setPaymentOpen, paymentOpenerRef)}
                  >
                    <Banknote className="size-4" aria-hidden />
                    Record payment
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => rememberOpener(setVoidOpen, voidOpenerRef)}
                >
                  <Ban className="size-4" aria-hidden />
                  Void
                </Button>
              </>
            )}
          </>
        }
      />

      {isVoid && invoice.voidReason && (
        <div role="status" className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Voided {invoice.voidedAt ? formatFirmDate(invoice.voidedAt) : ''} — {invoice.voidReason}
        </div>
      )}

      {!invoice.pdfDocumentId && !isDraft && (
        <div
          role="status"
          className="rounded-lg border border-amber-border bg-amber-bg px-4 py-3 text-sm text-amber"
        >
          No PDF was produced for this invoice — the DOCX→PDF converter is not configured, so the
          Word version was sent instead. The emailed invoice still shows every line in full.
        </div>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <InvoicePreview
          data={{
            firmName: firm.name,
            remitTo: firm.remitTo,
            billToName: invoice.billToName ?? invoice.clientName,
            billToEmail: invoice.billToEmail ?? invoice.clientEmail,
            matterNumber: invoice.matterNumber,
            number: invoice.number,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            lines: invoice.lines,
            subtotalCents: invoice.subtotalCents,
            collectedCents: invoice.collected,
            notes: invoice.notes,
            terms: invoice.terms,
            paymentLink: invoice.paymentLink,
          }}
        />

        <div className="min-w-0 space-y-3">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Total</span>
                <span className="tabular-nums">{moneyExact(invoice.subtotalCents)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Collected</span>
                <span className="tabular-nums">{moneyExact(invoice.collected)}</span>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <span>Balance</span>
                <span className="tabular-nums">{moneyExact(invoice.balance)}</span>
              </div>
              {invoice.sentAt && (
                <p className="pt-2 text-xs text-muted-foreground">
                  Sent {formatFirmDateTime(invoice.sentAt)}
                </p>
              )}
              {invoice.lastRemindedAt && (
                <p className="text-xs text-muted-foreground">
                  Last reminded {formatFirmDateTime(invoice.lastRemindedAt)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm">Payments</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {invoice.payments.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  No payments recorded against this invoice.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Received</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="pr-4 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.payments.map(payment => (
                      <TableRow key={payment.paymentGroupId}>
                        <TableCell className="pl-4">{formatFirmDate(payment.receivedAt)}</TableCell>
                        <TableCell>
                          {methodLabels[payment.method]}
                          {payment.note && (
                            <p className="text-xs text-muted-foreground">{payment.note}</p>
                          )}
                        </TableCell>
                        <TableCell className="pr-4 text-right tabular-nums">
                          {moneyExact(payment.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <RecordInvoicePaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        invoice={invoice}
        saving={busy === 'payment'}
        returnFocusRef={paymentOpenerRef}
        onSave={recordPayment}
      />

      <VoidInvoiceDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        invoiceNumber={invoice.number}
        voiding={busy === 'void'}
        returnFocusRef={voidOpenerRef}
        onConfirm={voidInvoice}
      />
    </AdminPageShell>
  )
}
