import { Skeleton } from '@/components/ui/skeleton'

/**
 * Matches CalendarClient: `space-y-4`, a title row carrying the day/week/month
 * /plan switch and the date controls, then the grid. The grid block is sized to
 * the week view, which is the one the page opens on.
 */
export default function CalendarLoading() {
  return (
    <div className="space-y-4" aria-label="Loading calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-7 w-32" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-[34rem] rounded-lg" />
    </div>
  )
}
