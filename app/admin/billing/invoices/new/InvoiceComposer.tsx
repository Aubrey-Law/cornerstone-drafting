'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, Save } from 'lucide-react'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { InvoicePreview } from '@/components/billing/InvoicePreview'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
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
  invoiceTermLabels,
  invoiceTerms,
  resolveDueDate,
  type InvoiceableCharge,
  type InvoiceTerm,
} from '@/lib/billing/invoices'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { moneyExact } from '@/app/admin/billing/financeFormat'
import type { BillingMatterOption } from '@/components/billing/AddChargeDialog'
import { ReceiptText } from 'lucide-react'

/**
 * The invoice composer: pick a matter, tick the charges to bill, and watch the
 * document assemble beside the form.
 *
 * A route rather than a dialog — a live document preview needs the width, and
 * the URL is worth having so the ledger can deep-link a pre-filled invoice.
 * Totals are computed here, synchronously, so typing never waits on a request.
 */
export default function InvoiceComposer({
  matters,
  initialMatterId,
  initialCharges,
  preselectedChargeIds,
  today,
  firm,
}: {
  matters: BillingMatterOption[]
  initialMatterId: string | null
  initialCharges: InvoiceableCharge[]
  preselectedChargeIds: string[]
  today: string
  firm: { name: string; remitTo: string }
}) {
  const router = useRouter()
  const token = useAccessToken()
  const [matterId, setMatterId] = useState(initialMatterId ?? '')
  const [charges, setCharges] = useState<InvoiceableCharge[]>(initialCharges)
  const [loadingCharges, setLoadingCharges] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>(
    // Everything outstanding is billed by default: the common case is "bill
    // this matter", not "bill part of this matter".
    Object.fromEntries(
      (preselectedChargeIds.length > 0
        ? preselectedChargeIds
        : initialCharges.map(charge => charge.id)
      ).map(id => [id, true]),
    ),
  )
  const [issueDate, setIssueDate] = useState(today)
  const [term, setTerm] = useState<InvoiceTerm>('net_30')
  const [billToName, setBillToName] = useState('')
  const [billToEmail, setBillToEmail] = useState('')
  const [paymentLink, setPaymentLink] = useState('')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [saving, setSaving] = useState<'draft' | 'issue' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dueDate = useMemo(() => resolveDueDate(issueDate, term), [issueDate, term])
  const chosen = useMemo(
    () => charges.filter(charge => selected[charge.id]),
    [charges, selected],
  )
  const subtotalCents = useMemo(
    () => chosen.reduce((sum, charge) => sum + charge.amountBilled, 0),
    [chosen],
  )
  const matterLabel = matters.find(matter => matter.id === matterId)?.label ?? ''

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
        setSelected(Object.fromEntries(next.map(charge => [charge.id, true])))
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

  async function submit(mode: 'draft' | 'issue') {
    if (!matterId) {
      setError('Choose a matter to bill.')
      return
    }
    if (chosen.length === 0) {
      setError('Tick at least one charge to bill.')
      return
    }
    setError(null)
    setSaving(mode)
    try {
      const created = await fetch('/api/admin/billing/invoices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          matterId,
          itemIds: chosen.map(charge => charge.id),
          issueDate,
          dueDate,
          notes: notes.trim() || null,
          terms: terms.trim() || null,
          billToName: billToName.trim() || null,
          billToEmail: billToEmail.trim() || null,
          paymentLink: paymentLink.trim() || null,
        }),
      })
      const createdJson = await created.json().catch(() => ({})) as {
        invoice?: { id: string }
        error?: string
      }
      if (!created.ok || !createdJson.invoice) {
        throw new Error(createdJson.error ?? 'Could not create the invoice')
      }

      const invoiceId = createdJson.invoice.id
      if (mode === 'draft') {
        toast.success('Draft invoice saved')
        router.push(`/admin/billing/invoices/${invoiceId}`)
        return
      }

      const issued = await fetch(`/api/admin/billing/invoices/${invoiceId}/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ send: true }),
      })
      const issuedJson = await issued.json().catch(() => ({})) as {
        error?: string
        warning?: string
        sent?: boolean
      }
      if (!issued.ok && issued.status !== 207) {
        // The draft exists; take the user to it so the work is not lost.
        router.push(`/admin/billing/invoices/${invoiceId}`)
        throw new Error(issuedJson.error ?? 'The invoice was saved but could not be issued')
      }
      if (issuedJson.warning) toast.warning(issuedJson.warning)
      else if (issuedJson.sent) toast.success('Invoice issued and emailed')
      else toast.success('Invoice issued')
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
          <Select value={matterId} onValueChange={setMatterId}>
            <SelectTrigger id="invoice-matter" className="min-h-11 w-full">
              <SelectValue placeholder="Choose a matter" />
            </SelectTrigger>
            <SelectContent>
              {matters.map(matter => (
                <SelectItem key={matter.id} value={matter.id}>{matter.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoice-issue-date">Issue date</Label>
            <Input
              id="invoice-issue-date"
              type="date"
              value={issueDate}
              onChange={event => setIssueDate(event.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoice-terms">Payment terms</Label>
            <Select value={term} onValueChange={value => setTerm(value as InvoiceTerm)}>
              <SelectTrigger id="invoice-terms" className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {invoiceTerms.map(value => (
                  <SelectItem key={value} value={value}>{invoiceTermLabels[value]}</SelectItem>
                ))}
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
            <p className="rounded-md border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              {matterId
                ? 'This matter has no uninvoiced charges. Add a charge on the Billing page first.'
                : 'Choose a matter to see what can be billed.'}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {charges.map(charge => (
                <li key={charge.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    id={`charge-${charge.id}`}
                    checked={Boolean(selected[charge.id])}
                    onCheckedChange={checked =>
                      setSelected(current => ({ ...current, [charge.id]: checked === true }))}
                  />
                  <Label
                    htmlFor={`charge-${charge.id}`}
                    className="min-w-0 flex-1 cursor-pointer font-normal"
                  >
                    {charge.label}
                  </Label>
                  <span className="tabular-nums text-sm">{moneyExact(charge.amountBilled)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2.5">
                <span className="text-sm font-medium">
                  {chosen.length} of {charges.length} selected
                </span>
                <span className="tabular-nums text-sm font-semibold">{moneyExact(subtotalCents)}</span>
              </li>
            </ul>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="invoice-bill-to">Bill to (optional)</Label>
            <Input
              id="invoice-bill-to"
              value={billToName}
              onChange={event => setBillToName(event.target.value)}
              placeholder={matterLabel.split(' · ')[0] || 'Client name'}
              className="min-h-11"
            />
          </div>
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
        </div>

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

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )

  const preview = (
    <InvoicePreview
      data={{
        firmName: firm.name,
        remitTo: firm.remitTo,
        billToName: billToName.trim() || matterLabel.split(' · ')[0] || 'Client',
        billToEmail: billToEmail.trim() || null,
        matterNumber: matterLabel.includes(' · ') ? matterLabel.split(' · ')[1] : null,
        number: null,
        issueDate,
        dueDate,
        lines: chosen.map(charge => ({
          description: charge.label,
          amountCents: charge.amountBilled,
        })),
        subtotalCents,
        collectedCents: 0,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
        paymentLink: paymentLink.trim() || null,
      }}
    />
  )

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="New invoice"
        description="Group a matter’s open charges into one bill, then issue and email it."
        actions={
          <>
            <Button asChild variant="ghost" className="min-h-11">
              <Link href="/admin/billing">
                <ArrowLeft className="size-4" aria-hidden />
                Back to billing
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
              {saving === 'draft' ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={saving !== null || chosen.length === 0}
              onClick={() => void submit('issue')}
            >
              <Send className="size-4" aria-hidden />
              {saving === 'issue' ? 'Issuing…' : 'Issue & send'}
            </Button>
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
