import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getCachedClaims } from '@/lib/supabaseServer'
import { firmTodayKey } from '@/lib/firmDate'
import { loadFirmSettings } from '@/lib/firmSettings'
import { fetchBillingMatterOptions } from '@/lib/queries/billing'
import { fetchInvoice, fetchInvoiceableCharges } from '@/lib/queries/invoices'
import { InvoiceComposer } from '@/components/billing/InvoiceComposer'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Edit invoice' }

/**
 * Editing reuses the composer rather than duplicating a second form: the
 * fields, the totals and the live preview are the same, and only the save
 * differs. Restricted to drafts because `update_invoice_draft` refuses
 * anything else — an issued invoice is voided and reissued instead.
 */
export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth = await getCachedClaims()
  if (!auth) return null

  const { id } = await params
  const invoice = await fetchInvoice(id)
  if (!invoice) notFound()
  // Sending the user to a form the server would reject is worse than sending
  // them back to the invoice they came from.
  if (invoice.status !== 'draft') redirect(`/admin/billing/invoices/${id}`)

  const [matters, firm, charges] = await Promise.all([
    fetchBillingMatterOptions(),
    loadFirmSettings(),
    fetchInvoiceableCharges(invoice.matterId, invoice.id),
  ])

  const cityStateZip = [[firm.city, firm.state].filter(Boolean).join(', '), firm.zip]
    .filter(Boolean)
    .join(' ')

  const lineChargeIds = invoice.lines
    .map(line => line.billingItemId)
    .filter((chargeId): chargeId is string => chargeId !== null)

  return (
    <InvoiceComposer
      matters={matters}
      initialMatterId={invoice.matterId}
      initialCharges={charges}
      preselectedChargeIds={lineChargeIds}
      today={firmTodayKey()}
      firm={{
        name: firm.firmName,
        remitTo: [firm.firmName, firm.street, cityStateZip, firm.phone, firm.email]
          .filter(Boolean)
          .join(' · '),
      }}
      draft={{
        invoiceId: invoice.id,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes,
        terms: invoice.terms,
        billToName: invoice.billToName,
        billToEmail: invoice.billToEmail,
        paymentLink: invoice.paymentLink,
        orphanedLineCount: invoice.lines.length - lineChargeIds.length,
      }}
    />
  )
}
