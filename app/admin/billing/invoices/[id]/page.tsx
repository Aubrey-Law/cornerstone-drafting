import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadFirmSettings } from '@/lib/firmSettings'
import { fetchInvoice } from '@/lib/queries/invoices'
import { getCachedClaims } from '@/lib/supabaseServer'
import InvoiceDetailClient from './InvoiceDetailClient'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice' }

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const auth = await getCachedClaims()
  if (!auth) return null

  const { id } = await params
  const [invoice, firm] = await Promise.all([fetchInvoice(id), loadFirmSettings()])
  if (!invoice) notFound()

  const cityStateZip = [[firm.city, firm.state].filter(Boolean).join(', '), firm.zip]
    .filter(Boolean)
    .join(' ')

  return (
    <InvoiceDetailClient
      invoice={invoice}
      firm={{
        name: firm.firmName,
        remitTo: [firm.firmName, firm.street, cityStateZip, firm.phone, firm.email]
          .filter(Boolean)
          .join(' · '),
      }}
    />
  )
}
