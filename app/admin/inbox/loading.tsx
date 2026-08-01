import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { Skeleton } from '@/components/ui/skeleton'

export default function InboxLoading() {
  return (
    <AdminPageShell aria-label="Loading inbox">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[392px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
        <Skeleton className="hidden h-96 rounded-lg md:block" />
      </div>
    </AdminPageShell>
  )
}
