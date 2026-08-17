import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { InvoiceListTable } from '@/components/billing/InvoiceListTable'
import { fetchInvoices } from '@/lib/queries/invoices'
import { getCachedClaims } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoices' }

export default async function InvoicesPage() {
  const auth = await getCachedClaims()
  if (!auth) return null

  const invoices = await fetchInvoices()

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Invoices"
        description="Every bill the firm has issued, newest first."
        actions={
          <>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/admin/billing">Back to billing</Link>
            </Button>
            <Button asChild className="min-h-11">
              <Link href="/admin/billing/invoices/new">
                <Plus className="size-4" aria-hidden />
                New invoice
              </Link>
            </Button>
          </>
        }
      />

      <Card className="min-w-0 gap-0 py-0">
        <CardContent className="px-0">
          <InvoiceListTable invoices={invoices} />
        </CardContent>
      </Card>
    </AdminPageShell>
  )
}
