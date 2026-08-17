import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus, ReceiptText } from 'lucide-react'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { moneyExact } from '@/app/admin/billing/financeFormat'
import { fetchInvoices } from '@/lib/queries/invoices'
import { formatFirmDate } from '@/lib/format'
import { getCachedClaims } from '@/lib/supabaseServer'
import { cn } from '@/lib/utils'

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
          {invoices.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No invoices yet"
              description="Group a matter’s open charges into a bill and send it from here."
              action={
                <Button asChild className="min-h-11">
                  <Link href="/admin/billing/invoices/new">New invoice</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Invoice</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(invoice => (
                    <TableRow key={invoice.id}>
                      <TableCell className="pl-4">
                        <Link
                          href={`/admin/billing/invoices/${invoice.id}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {invoice.number ?? 'Draft'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/matters/${invoice.matterId}`}
                          className="hover:text-primary hover:underline"
                        >
                          {invoice.clientName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {invoice.matterNumber ?? 'No matter number'}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.issueDate ? formatFirmDate(invoice.issueDate) : '—'}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-muted-foreground',
                          invoice.overdue && 'font-semibold text-destructive',
                        )}
                      >
                        {invoice.dueDate ? formatFirmDate(invoice.dueDate) : '—'}
                        {invoice.overdue && ` · ${invoice.daysPastDue}d late`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {moneyExact(invoice.subtotalCents)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {moneyExact(invoice.balance)}
                      </TableCell>
                      <TableCell className="pr-4">
                        <InvoiceStatusBadge invoice={invoice} overdue={invoice.overdue} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AdminPageShell>
  )
}
