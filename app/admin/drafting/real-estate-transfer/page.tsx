import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function RealEstateTransferPage() {
  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/drafting"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Drafting
          </Link>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Real Estate Transfer</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Real estate transfers are now configured per matter in the design sheet.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-foreground">
            Open a matter&apos;s drafting workspace and go to the <strong>Transfers &amp; Assignments</strong> section
            to upload a deed PDF, configure the realty trust, and generate transfer documents.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Client, spouse, property, trust, and fiduciary details are pre-filled from the matter design sheet.
          </p>
          <Link
            href="/admin/drafting"
            className="mt-4 inline-flex rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            Go to Drafting
          </Link>
        </div>
      </div>
    </div>
  )
}
