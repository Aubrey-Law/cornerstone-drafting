import { Skeleton } from '@/components/ui/skeleton'

/**
 * Matches TasksClient's own shell: `w-full space-y-4`, a PageHeader with an
 * eyebrow, and two header actions. A skeleton whose shape disagrees with the
 * page trades a dead click for a layout shift, which is not a trade.
 */
export default function TasksLoading() {
  return (
    <div className="w-full space-y-4" aria-label="Loading tasks">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-[34rem] max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-14 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
