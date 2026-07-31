import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { Skeleton } from '@/components/ui/skeleton'

export default function BillingLoading() {
  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]" aria-label="Loading billing">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-36 w-full rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Skeleton className="h-96 rounded-lg" />
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      </div>
    </AdminPageShell>
  )
}
