import { NavigationReady } from '@/app/admin/components/NavigationTiming'
import Link from 'next/link'
import Form from 'next/form'
import {
  fetchInvoicePage,
  invoiceQueueFilters,
  type InvoiceQueueFilter,
} from '@/lib/queries/invoices'
import { pageRequest } from '@/lib/queries/page'
import { InvoiceListTable } from '@/components/billing/InvoiceListTable'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus } from 'lucide-react'
import { BillingViewNav } from './BillingViewNav'

const queueLabels: Record<InvoiceQueueFilter, string> = {
  attention: 'Needs attention',
  draft: 'Drafts',
  due_soon: 'Due soon',
  past_due: 'Past due',
  paid: 'Paid',
  all: 'All',
}

export async function InvoiceRegister({ params }: { params: Record<string,string|string[]|undefined> }) {
  const value = (key:string) => typeof params[key] === 'string' ? params[key] as string : undefined
  const requestedQueue = value('queue')
  const queue: InvoiceQueueFilter = invoiceQueueFilters.includes(requestedQueue as InvoiceQueueFilter)
    ? requestedQueue as InvoiceQueueFilter
    : 'attention'
  const search = value('search')?.trim() ?? ''
  const result = await fetchInvoicePage({ ...pageRequest({ page:value('page') }), queue, search })

  const queryFor = (next: { queue?: InvoiceQueueFilter; page?: number; search?: string } = {}) => {
    const query = new URLSearchParams({ tab: 'invoices' })
    const nextQueue = next.queue ?? queue
    const nextSearch = next.search ?? search
    if (nextQueue !== 'attention') query.set('queue', nextQueue)
    if (nextSearch) query.set('search', nextSearch)
    if ((next.page ?? 1) > 1) query.set('page', String(next.page))
    return `/admin/billing?${query}`
  }

  const href = (page:number) => {
    return queryFor({ page })
  }
  const queueDescription = queueLabels[queue].toLowerCase()
  const resultLabel = `${result.total} ${queueDescription} invoice${result.total === 1 ? '' : 's'}${search ? ` matching “${search}”` : ''}`

  return <AdminPageShell className="mx-auto w-full max-w-[1440px]">
    <NavigationReady route="Billing" />
    <PageHeader title="Billing" description="Charges, invoices, payments, and legal plan claims across all matters." actions={<Button asChild className="min-h-11"><Link href="/admin/billing/invoices/new"><Plus className="size-4" aria-hidden />New invoice</Link></Button>} />
    <BillingViewNav active="invoices" />
    <Form action="/admin/billing" role="search" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
      <input type="hidden" name="tab" value="invoices" />
      {queue !== 'attention' ? <input type="hidden" name="queue" value={queue} /> : null}
      <label className="sr-only" htmlFor="invoice-search">Search invoices</label>
      <Input id="invoice-search" className="min-h-11 min-w-[16rem] flex-1 sm:max-w-sm" type="search" name="search" defaultValue={search} placeholder="Client, matter, or invoice…" />
      <Button type="submit" variant="outline" className="min-h-11">Search</Button>
      {search ? <Link href={queryFor({ search: '' })} className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground hover:underline">Clear search</Link> : null}
    </Form>
    <nav aria-label="Invoice queues" className="flex flex-wrap gap-2">
      {invoiceQueueFilters.map(item => <Link
        key={item}
        href={queryFor({ queue: item, page: 1 })}
        aria-label={`${queueLabels[item]} ${result.counts[item]}`}
        aria-current={queue === item ? 'page' : undefined}
        className={queue === item
          ? 'inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground'
          : 'inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground'}
      >
        <span>{queueLabels[item]}</span>
        <span className="tabular-nums">{result.counts[item]}</span>
      </Link>)}
    </nav>
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{resultLabel} · page {result.page} of {Math.max(1,Math.ceil(result.total/result.pageSize))}</span>
      {result.page > 1 && <Link href={href(result.page-1)} className="underline">Previous</Link>}
      {result.page*result.pageSize < result.total && <Link href={href(result.page+1)} className="underline">Next</Link>}
    </div>
    {result.total === 0 ? <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No invoices match this queue.</p> : <InvoiceListTable invoices={result.rows} />}
  </AdminPageShell>
}
