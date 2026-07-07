import Link from 'next/link'
import RealEstateTransferClient from './RealEstateTransferClient'

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
          Upload an existing deed PDF, review extracted fields, then generate a deed, trustee&apos;s certificate, and/or real estate trust document.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-3xl">
          <RealEstateTransferClient />
        </div>
      </div>
    </div>
  )
}
