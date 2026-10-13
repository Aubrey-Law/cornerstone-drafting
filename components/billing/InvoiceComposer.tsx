'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Send, Save } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { InvoicePreview } from '@/components/billing/InvoicePreview'
import { BillingMatterPicker } from '@/components/billing/BillingMatterPicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { ledgerChargeLabel } from '@/lib/billing/ledgerCopy'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  chargePayer,
  inferTerm,
  invoicePayerLabels,
  invoicePayers,
  invoiceTermLabels,
  invoiceTerms,
  resolveDueDate,
  type InvoiceableCharge,
  type InvoicePayer,
  type InvoiceTerm,
} from '@/lib/billing/invoices'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { downloadInvoiceDocument } from '@/lib/invoices/downloadInvoice'
import { moneyExact } from '@/app/admin/billing/financeFormat'
import type { BillingMatterOption } from '@/components/billing/AddChargeDialog'
import { ReceiptText } from 'lucide-react'

/**
 * A draft being edited rather than a new invoice being composed. The matter is
 * absent on purpose: `update_invoice_draft` cannot move an invoice to another
 * matter, because its charges live on the one it was drawn from.
 */
export interface ComposerDraft {
  invoiceId: string
  issueDate: string | null
  dueDate: string | null
  notes: string | null
  terms: string | null
  billToName: string | null
  billToEmail: string | null
  paymentLink: string | null
  /** Lines whose charge has since been deleted, which an edit cannot carry over. */
  orphanedLineCount: number
}

/**
 * What a fresh composer ticks: everything one payer is owed. The client's
 * charges win when a matter has both, since that is the bill that goes out;
 * a plan-only matter gets its claims.
 */
function defaultSelection(charges: InvoiceableCharge[]): Record<string, boolean> {
  const payer: InvoicePayer | undefined = charges.some(charge => chargePayer(charge) === 'client')
    ? 'client'
    : charges[0] && chargePayer(charges[0])
  return Object.fromEntries(
    charges.filter(charge => chargePayer(charge) === payer).map(charge => [charge.id, true]),
  )
}

/**
 * The invoice composer: pick a matter, tick the charges to bill, and watch the
 * document assemble beside the form.
 *
 * A route rather than a dialog — a live document preview needs the width, and
 * the URL is worth having so the ledger can deep-link a pre-filled invoice.
 * Totals are computed here, synchronously, so typing never waits on a request.
 *
 * The same component edits a saved draft (`draft` set): the fields and the
 * rules behind them are identical, only the matter is fixed and the save is a
 * PATCH onto an invoice that already exists.
 *
 * An invoice bills one payer. Legal plan claims bill their carrier, so a
 * MetLife matter's claims become a MetLife invoice — the firm's record of what
 * was billed to the plan, issued but never emailed or shown to the client.
 * Ticking a charge for another payer clears the rest rather than letting the
 * database refuse the mix on save.
 */
export function InvoiceComposer({
  matters,
  initialMatterId,
  initialCharges,
  preselectedChargeIds,
  today,
  firm,
  draft,
}: {
  matters: BillingMatterOption[]
  initialMatterId: string | null
  initialCharges: InvoiceableCharge[]
  preselectedChargeIds: string[]
  today: string
  firm: { name: string; remitTo: string }
  /** Set to edit an existing draft instead of composing a new invoice. */
  draft?: ComposerDraft
}) {
  const router = useRouter()
  const token = useAccessToken()
  const [matterId, setMatterId] = useState(initialMatterId ?? '')
  const [charges, setCharges] = useState<InvoiceableCharge[]>(initialCharges)
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>(
    // Everything outstanding is billed by default: the common case is "bill
    // this matter", not "bill part of this matter". Editing instead restores
    // exactly what the draft holds, even if that is a subset.
    draft || preselectedChargeIds.length > 0
      ? Object.fromEntries(preselectedChargeIds.map(id => [id, true]))
      : defaultSelection(initialCharges),
  )
  const initialIssueDate = draft?.issueDate ?? today
  const [issueDate, setIssueDate] = useState(initialIssueDate)
  // A draft whose stored dates match no term keeps them as 'custom' rather
  // than being silently snapped to Net 30 the moment it is opened.
  const [term, setTerm] = useState<InvoiceTerm | 'custom'>(
    draft ? inferTerm(draft.issueDate, draft.dueDate) ?? 'custom' : 'net_30',
  )
  const [dueDate, setDueDate] = useState(
    draft?.dueDate ?? resolveDueDate(initialIssueDate, 'net_30'),
  )
  const [billToName, setBillToName] = useState(draft?.billToName ?? '')
  const [billToEmail, setBillToEmail] = useState(draft?.billToEmail ?? '')
  const [paymentLink, setPaymentLink] = useState(draft?.paymentLink ?? '')
  const [notes, setNotes] = useState(draft?.notes ?? '')
  const [terms, setTerms] = useState(draft?.terms ?? '')
  const [saving, setSaving] = useState<'draft' | 'issue' | 'send' | 'download' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The term drives the due date; it never reads back from it, so a custom due
  // date survives until a real term is chosen.
  function changeIssueDate(next: string) {
    setIssueDate(next)
    if (next && term !== 'custom') setDueDate(resolveDueDate(next, term))
  }
  function changeTerm(next: InvoiceTerm | 'custom') {
    setTerm(next)
    if (issueDate && next !== 'custom') setDueDate(resolveDueDate(issueDate, next))
  }
  const chosen = useMemo(
    () => charges.filter(charge => selected[charge.id]),
    [charges, selected],
  )
  const subtotalCents = useMemo(
    () => chosen.reduce((sum, charge) => sum + charge.amountBilled, 0),
    [chosen],
  )
  const matterLabel = matters.find(matter => matter.id === matterId)?.label ?? ''
  const payer: InvoicePayer = chosen[0] ? chargePayer(chosen[0]) : 'client'
  const carrier = payer !== 'client'
  // Grouped only when the matter actually has more than one payer; a plain
  // list otherwise, as before.
  const payerGroups = useMemo(
    () => invoicePayers
      .map(group => ({ payer: group, charges: charges.filter(charge => chargePayer(charge) === group) }))
      .filter(group => group.charges.length > 0),
    [charges],
  )
  const clientName = matterLabel.split(' · ')[0] || 'Client'
  const defaultBillTo = carrier ? invoicePayerLabels[payer] : clientName

  function toggleCharge(charge: InvoiceableCharge, checked: boolean) {
    setSelected(current => {
      if (!checked) return { ...current, [charge.id]: false }
      const group = chargePayer(charge)
      return Object.fromEntries(
        charges
          .filter(other => other.id === charge.id || (current[other.id] && chargePayer(other) === group))
          .map(other => [other.id, true]),
      )
    })
  }

  // Reload the charge list whenever the matter changes, and default the new
  // matter's charges to selected so the preview is never empty on arrival.
  useEffect(() => {
    if (!matterId || matterId === initialMatterId) return
    let cancelled = false
    setLoadingCharges(true)
    fetch(`/api/admin/billing/invoices/matters/${matterId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(response => response.json())
      .then((json: { charges?: InvoiceableCharge[]; error?: string }) => {
        if (cancelled) return
        const next = json.charges ?? []
        setCharges(next)
        setSelected(defaultSelection(next))
        if (json.error) setError(json.error)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this matter’s charges.')
      })
      .finally(() => {
        if (!cancelled) setLoadingCharges(false)
      })
    return () => { cancelled = true }
  }, [matterId, initialMatterId, token])

  /**
   * Writes the form to the server and hands back the invoice id: a PATCH onto
   * the draft being edited, or a POST that creates one.
   */
  async function persist(): Promise<string> {
    const body = {
      itemIds: chosen.map(charge => charge.id),
      issueDate,
      dueDate,
      notes: notes.trim() || null,
      terms: terms.trim() || null,
      billToName: billToName.trim() || (carrier ? invoicePayerLabels[payer] : null),
      billToEmail: carrier ? null : billToEmail.trim() || null,
      paymentLink: carrier ? null : paymentLink.trim() || null,
    }
    const response = await fetch(
      draft ? `/api/admin/billing/invoices/${draft.invoiceId}` : '/api/admin/billing/invoices',
      {
        method: draft ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(draft ? body : { matterId, ...body }),
      },
    )
    const json = await response.json().catch(() => ({})) as {
      invoice?: { id: string }
      error?: string
    }
    if (!response.ok || !json.invoice) {
      throw new Error(json.error ?? (draft ? 'Could not save the invoice' : 'Could not create the invoice'))
    }
    return draft ? draft.invoiceId : json.invoice.id
  }

  /**
   * `download` issues the invoice without emailing it and hands back the PDF —
   * for a bill given to the client in person, posted, or sent from the
   * attorney's own mail client.
   */
  async function submit(mode: 'draft' | 'issue' | 'send' | 'download') {
    if (!matterId) {
      setError('Choose a matter to bill.')
      return
    }
    if (chosen.length === 0) {
      setError('Tick at least one charge to bill.')
      return
    }
    if (dueDate < issueDate) {
      setError('The due date cannot fall before the issue date.')
      return
    }
    setError(null)
    setSaving(mode)
    try {
      const invoiceId = await persist()
      if (mode === 'draft') {
        toast.success(draft ? 'Draft invoice updated' : 'Draft invoice saved')
        router.push(`/admin/billing/invoices/${invoiceId}`)
        return
      }

      const issued = await fetch(`/api/admin/billing/invoices/${invoiceId}/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ send: mode === 'send' }),
      })
      const issuedJson = await issued.json().catch(() => ({})) as {
        error?: string
        warning?: string
        sent?: boolean
        pdfUnavailableReason?: string | null
        invoice?: {
          number: string | null
          pdfDocumentId: string | null
          docxDocumentId: string | null
        }
      }
      if (!issued.ok && issued.status !== 207) {
        // The draft exists; take the user to it so the work is not lost.
        router.push(`/admin/billing/invoices/${invoiceId}`)
        throw new Error(issuedJson.error ?? 'The invoice was saved but could not be issued')
      }
      if (issuedJson.warning) toast.warning(issuedJson.warning)
      else if (issuedJson.sent) toast.success('Invoice issued and emailed')
      else if (carrier) toast.success(`Invoice issued to ${invoicePayerLabels[payer]}; its claims are marked submitted`)
      else toast.success('Invoice issued')

      if (mode === 'download') {
        const documentId = issuedJson.invoice?.pdfDocumentId
          ?? issuedJson.invoice?.docxDocumentId
          ?? null
        if (documentId) {
          // Handing over a .docx when a PDF was asked for is worth saying out
          // loud — otherwise the difference is only visible in the file name.
          if (!issuedJson.invoice?.pdfDocumentId && issuedJson.pdfUnavailableReason) {
            toast.warning('No PDF could be produced, so this is the Word version.')
          }
          try {
            await downloadInvoiceDocument({
              documentId,
              invoiceNumber: issuedJson.invoice?.number ?? null,
              isPdf: Boolean(issuedJson.invoice?.pdfDocumentId),
            })
          } catch {
            // The invoice is issued either way; only the download failed, and
            // the detail page it lands on offers the same button.
            toast.error('Invoice issued, but the download could not start')
          }
        } else if (!issuedJson.warning) {
          toast.warning('Invoice issued, but no document was produced to download')
        }
      }

      router.push(`/admin/billing/invoices/${invoiceId}`)
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Could not save the invoice'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(null)
    }
  }

  const form = (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">Invoice details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="invoice-matter">Matter</Label>
          {/* Fixed while editing: the draft's charges belong to this matter,
              so moving it would mean discarding and starting again. */}
          <BillingMatterPicker id="invoice-matter" value={matterId} onChange={setMatterId} initialOptions={matters} disabled={Boolean(draft)} />
          {draft && (
            <p className="text-xs text-muted-foreground">
              Discard this draft to bill a different matter.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoice-issue-date">Issue date</Label>
            <Input
              id="invoice-issue-date"
              type="date"
              value={issueDate}
              onChange={event => changeIssueDate(event.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-terms">Payment terms</Label>
            <Select value={term} onValueChange={value => changeTerm(value as InvoiceTerm | 'custom')}>
              <SelectTrigger id="invoice-terms" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {invoiceTerms.map(value => (
                  <SelectItem key={value} value={value}>{invoiceTermLabels[value]}</SelectItem>
                ))}
                {/* Only ever reachable on a draft saved with a due date that
                    matches no term — offered so it can be kept, not chosen. */}
                {term === 'custom' && <SelectItem value="custom">Custom</SelectItem>}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Due {dueDate}</p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Charges to bill</legend>
          {loadingCharges ? (
            <p className="py-4 text-sm text-muted-foreground">Loading charges…</p>
          ) : charges.length === 0 ? (
            <p className="rounded-md border border-border bg-muted px-3 py-3 text-sm text-muted-foreground">
              {matterId
                ? 'Everything on this matter is already invoiced. Add a charge to bill something new.'
                : 'Choose a matter to see what can be billed.'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {payerGroups.map(group => (
                <li key={group.payer} className="divide-y divide-border">
                  {payerGroups.length > 1 && (
                    <p className="bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                      {group.payer === 'client' ? 'Billed to the client' : `Billed to ${invoicePayerLabels[group.payer]}`}
                    </p>
                  )}
                  <ul className="divide-y divide-border">
                    {group.charges.map(charge => (
                      <li key={charge.id} className="flex items-center gap-3 px-3 py-2.5">
                        <Checkbox
                          id={`charge-${charge.id}`}
                          checked={Boolean(selected[charge.id])}
                          onCheckedChange={checked => toggleCharge(charge, checked === true)}
                        />
                        <Label
                          htmlFor={`charge-${charge.id}`}
                          className="min-w-0 flex-1 cursor-pointer font-normal"
                        >
                          {ledgerChargeLabel(charge.label, charge.amountBilled)}
                        </Label>
                        <span className="tabular-nums text-sm">{moneyExact(charge.amountBilled)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 bg-muted px-3 py-2.5">
                <span className="text-sm font-medium">
                  {chosen.length} of {charges.length} selected
                </span>
                <span className="tabular-nums text-sm font-semibold">{moneyExact(subtotalCents)}</span>
              </li>
            </ul>
          )}
          {payerGroups.length > 1 && (
            <p className="text-xs text-muted-foreground">
              An invoice bills one payer. Client charges and legal plan claims go on separate invoices.
            </p>
          )}
          {carrier && (
            <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              Billed to {invoicePayerLabels[payer]}. This invoice is the firm&rsquo;s record of the
              claims: it is not emailed or shown to the client, and issuing it marks its claims
              submitted.
            </p>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoice-bill-to">Bill to (optional)</Label>
            <Input
              id="invoice-bill-to"
              value={billToName}
              onChange={event => setBillToName(event.target.value)}
              placeholder={defaultBillTo}
              className="min-h-11"
            />
          </div>
          {!carrier && (
            <div className="space-y-2">
              <Label htmlFor="invoice-bill-email">Send to (optional)</Label>
              <Input
                id="invoice-bill-email"
                type="email"
                value={billToEmail}
                onChange={event => setBillToEmail(event.target.value)}
                placeholder="Defaults to the client on file"
                className="min-h-11"
              />
            </div>
          )}
        </div>

        {!carrier && (
          <div className="space-y-2">
            <Label htmlFor="invoice-pay-link">Payment link (optional)</Label>
            <Input
              id="invoice-pay-link"
              type="url"
              value={paymentLink}
              onChange={event => setPaymentLink(event.target.value)}
              placeholder="https://…"
              className="min-h-11"
            />
            <p className="text-xs text-muted-foreground">
              Printed on the invoice and shown as a Pay button in the email.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="invoice-notes">Notes (optional)</Label>
          <Textarea
            id="invoice-notes"
            value={notes}
            onChange={event => setNotes(event.target.value)}
            rows={3}
            maxLength={2000}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invoice-terms-text">Terms (optional)</Label>
          <Textarea
            id="invoice-terms-text"
            value={terms}
            onChange={event => setTerms(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="e.g. Payment is due within 30 days of the invoice date."
          />
        </div>

        {draft && draft.orphanedLineCount > 0 && (
          <p
            role="status"
            className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber"
          >
            {draft.orphanedLineCount} line{draft.orphanedLineCount === 1 ? '' : 's'} on this draft
            {draft.orphanedLineCount === 1 ? ' refers' : ' refer'} to a charge that has since been
            deleted. Saving will drop {draft.orphanedLineCount === 1 ? 'it' : 'them'}.
          </p>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )

  const preview = (
    <InvoicePreview
      data={{
        firmName: firm.name,
        remitTo: firm.remitTo,
        billToName: billToName.trim() || defaultBillTo,
        billToEmail: carrier ? null : billToEmail.trim() || null,
        matterNumber: matterLabel.includes(' · ') ? matterLabel.split(' · ')[1] : null,
        number: null,
        issueDate,
        dueDate,
        lines: chosen.map(charge => ({
          description: ledgerChargeLabel(charge.label, charge.amountBilled),
          amountCents: charge.amountBilled,
        })),
        subtotalCents,
        collectedCents: 0,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        paymentLink: carrier ? null : paymentLink.trim() || null,
      }}
    />
  )

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title={draft ? 'Edit draft invoice' : 'New invoice'}
        description={
          draft
            ? 'Change the charges, dates or wording. Nothing has been sent yet.'
            : 'Group a matter’s open charges into one bill — for the client, or for a legal plan carrier — then issue it.'
        }
        actions={
          <>
            <Button asChild variant="ghost" className="min-h-11">
              <Link href={draft ? `/admin/billing/invoices/${draft.invoiceId}` : '/admin/billing'}>
                <ArrowLeft className="size-4" aria-hidden />
                {draft ? 'Back to invoice' : 'Back to billing'}
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={saving !== null}
              onClick={() => void submit('draft')}
            >
              <Save className="size-4" aria-hidden />
              {saving === 'draft' ? 'Saving…' : draft ? 'Save changes' : 'Save draft'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={saving !== null || chosen.length === 0}
              onClick={() => void submit('download')}
            >
              <Download className="size-4" aria-hidden />
              {saving === 'download' ? 'Issuing…' : 'Issue & download'}
            </Button>
            {carrier ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={saving !== null || chosen.length === 0}
                onClick={() => void submit('issue')}
              >
                <Save className="size-4" aria-hidden />
                {saving === 'issue' ? 'Issuing…' : 'Issue invoice'}
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-11"
                disabled={saving !== null || chosen.length === 0}
                onClick={() => void submit('send')}
              >
                <Send className="size-4" aria-hidden />
                {saving === 'send' ? 'Issuing…' : 'Issue & send'}
              </Button>
            )}
          </>
        }
      />

      {matters.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No matters to bill"
          description="Open a matter and add a charge before creating an invoice."
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          {form}
          {/* On narrow screens the preview would push the form off-screen, so
              it collapses under a disclosure instead of sitting beside it. */}
          <div className="hidden min-w-0 xl:block">
            <div className="sticky top-4">{preview}</div>
          </div>
          <Collapsible className="min-w-0 xl:hidden">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11 w-full">
                Preview invoice
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">{preview}</CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </AdminPageShell>
  )
}
