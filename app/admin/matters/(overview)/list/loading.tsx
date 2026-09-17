import { Skeleton } from '@/components/ui/skeleton'

/**
 * Matters bleeds to the shell edges and keeps its title and filters in a bar
 * above the list, so the skeleton has to bleed too — the negative margins here
 * are MattersClient's own.
 */
export default function MattersLoading() {
  return (
    <div
      className="-mx-4 -mb-4 flex h-full flex-col bg-background md:-mx-6 md:-mb-6"
      aria-label="Loading matters"
    >
      <div className="space-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-9 min-w-[14rem] max-w-md flex-1 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-24 rounded-full" />
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 px-4 py-3 md:px-6">
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="h-11 rounded-md" />
        ))}
      </div>
    </div>
  )
}
