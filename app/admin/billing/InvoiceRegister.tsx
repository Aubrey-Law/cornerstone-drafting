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
    <PageHeader title="Invoices" description="Bills, balances, and payment status." actions={<Button asChild><Link href="/admin/billing/invoices/new">New invoice</Link></Button>} />
    <nav aria-label="Billing views" className="flex gap-4 text-sm"><Link href="/admin/billing">Ledger</Link><Link aria-current="page" href="/admin/billing?tab=invoices">Invoices</Link><Link href="/admin/billing?tab=insights">Insights</Link></nav>
    <Form action="/admin/billing" className="my-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value="invoices" />
      <label className="text-sm">Issue month <input className="ml-2 rounded border p-2" type="month" name="month" defaultValue={issueMonth} /></label>
      <label className="text-sm">Status <select className="ml-2 rounded border p-2" name="status" defaultValue={status ?? 'all'}>{['all','draft','issued','partial','paid','void'].map(s=><option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select></label>
      <Button type="submit" variant="outline">Apply</Button><Link href="/admin/billing?tab=invoices" className="text-sm underline">Clear filters</Link>
    </Form>
    <div className="mb-3 flex items-center gap-3 text-sm"><span>{result.total} matching invoices · page {result.page} of {Math.max(1,Math.ceil(result.total/result.pageSize))}</span>
      {result.page > 1 && <Link href={href(result.page-1)} className="underline">Previous</Link>}
      {result.page*result.pageSize < result.total && <Link href={href(result.page+1)} className="underline">Next</Link>}
    </div>
    {result.total === 0 ? <p className="rounded border p-5">No invoices match these filters.</p> : <InvoiceListTable invoices={result.rows} />}
  </AdminPageShell>
}
