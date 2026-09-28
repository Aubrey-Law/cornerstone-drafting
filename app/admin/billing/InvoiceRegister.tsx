import { NavigationReady } from '@/app/admin/components/NavigationTiming'
import Link from 'next/link'
import Form from 'next/form'
import { fetchInvoicePage } from '@/lib/queries/invoices'
import { pageRequest } from '@/lib/queries/page'
import type { InvoiceStatus } from '@/lib/billing/invoices'
import { InvoiceListTable } from '@/components/billing/InvoiceListTable'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus } from 'lucide-react'
import { BillingViewNav } from './BillingViewNav'
export async function InvoiceRegister({ params }: { params: Record<string,string|string[]|undefined> }) {
  const value = (key:string) => typeof params[key] === 'string' ? params[key] as string : undefined
  const status = value('status') && value('status') !== 'all' ? value('status') as InvoiceStatus : undefined
  const issueMonth = value('month') || undefined
  const result = await fetchInvoicePage({ ...pageRequest({ page:value('page') }),status,issueMonth })
  const href = (page:number) => {
    const query=new URLSearchParams({tab:'invoices',page:String(page)})
    if(status) query.set('status',status)
    if(issueMonth) query.set('month',issueMonth)
    return `/admin/billing?${query}`
  }
  return <AdminPageShell className="mx-auto w-full max-w-[1440px]">
    <NavigationReady route="Billing" />
    <PageHeader title="Billing" description="Charges, invoices, payments, and legal plan claims across all matters." actions={<Button asChild className="min-h-11"><Link href="/admin/billing/invoices/new"><Plus className="size-4" aria-hidden />New invoice</Link></Button>} />
    <BillingViewNav active="invoices" />
    <Form action="/admin/billing" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <input type="hidden" name="tab" value="invoices" />
      <label className="space-y-1 text-sm"><span className="block text-xs font-medium text-muted-foreground">Issue month</span><Input className="min-h-11 w-[10.5rem]" type="month" name="month" defaultValue={issueMonth} /></label>
      <label className="space-y-1 text-sm"><span className="block text-xs font-medium text-muted-foreground">Status</span><select className="min-h-11 rounded-md border border-input bg-background px-3 text-sm" name="status" defaultValue={status ?? 'all'}>{['all','draft','issued','partial','paid','void'].map(s=><option key={s} value={s}>{s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>)}</select></label>
      <Button type="submit" variant="outline" className="min-h-11">Apply</Button><Link href="/admin/billing?tab=invoices" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline">Clear filters</Link>
    </Form>
    <div className="mb-3 flex items-center gap-3 text-sm"><span>{result.total} matching invoices · page {result.page} of {Math.max(1,Math.ceil(result.total/result.pageSize))}</span>
      {result.page > 1 && <Link href={href(result.page-1)} className="underline">Previous</Link>}
      {result.page*result.pageSize < result.total && <Link href={href(result.page+1)} className="underline">Next</Link>}
    </div>
    {result.total === 0 ? <p className="rounded border p-5">No invoices match these filters.</p> : <InvoiceListTable invoices={result.rows} />}
  </AdminPageShell>
}
