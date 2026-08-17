import type { Metadata } from 'next'
import { getCachedClaims } from '@/lib/supabaseServer'
import { firmTodayKey } from '@/lib/firmDate'
import { loadFirmSettings } from '@/lib/firmSettings'
import { fetchBillingMatterOptions } from '@/lib/queries/billing'
import { fetchInvoiceableCharges } from '@/lib/queries/invoices'
import { InvoiceComposer } from '@/components/billing/InvoiceComposer'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'New invoice' }

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ matterId?: string | string[]; items?: string | string[] }>
}) {
  const auth = await getCachedClaims()
  if (!auth) return null

  const params = await searchParams
  const matterId = firstParam(params.matterId)
  const preselected = (firstParam(params.items) ?? '').split(',').filter(Boolean)

  const [matters, firm, charges] = await Promise.all([
    fetchBillingMatterOptions(),
    loadFirmSettings(),
    matterId ? fetchInvoiceableCharges(matterId) : Promise.resolve([]),
  ])

  const cityStateZip = [[firm.city, firm.state].filter(Boolean).join(', '), firm.zip]
    .filter(Boolean)
    .join(' ')

  return (
    <InvoiceComposer
      matters={matters}
      initialMatterId={matterId ?? null}
      initialCharges={charges}
      preselectedChargeIds={preselected}
      today={firmTodayKey()}
      firm={{
        name: firm.firmName,
        remitTo: [firm.firmName, firm.street, cityStateZip, firm.phone, firm.email]
          .filter(Boolean)
          .join(' · '),
      }}
    />
  )
}
