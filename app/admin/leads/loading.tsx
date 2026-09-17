import { Skeleton } from '@/components/ui/skeleton'

/** Matches LeadsClient: `space-y-3`, a PageHeader with export and filter actions. */
export default function LeadsLoading() {
  return (
    <div className="space-y-3" aria-label="Loading opportunities">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-[38rem] max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
      <div className="space-y-2">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-md" />
        ))}
      </div>
    </div>
  )
}
