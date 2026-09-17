import { Skeleton } from '@/components/ui/skeleton'

/**
 * The fallback for every admin route without a skeleton of its own — twenty of
 * them, at last count.
 *
 * It used to be the Today dashboard's skeleton, which reached all of them by
 * the usual Next.js cascade: `max-w-4xl`, centred, four stacked cards. The
 * contacts table, the matter detail's full-height split pane and the settings
 * panes all flashed that shape and then reflowed into something else.
 *
 * A skeleton is a promise about the page that is coming, and a wrong one is
 * worse than a plain one: it moves content twice and makes the app feel like it
 * changed its mind. So this promises only what is true of every admin route —
 * a title, and a region below it that fills the space. Routes whose shape is
 * worth pre-drawing have their own `loading.tsx`, the dashboard's now among
 * them.
 */
export default function AdminLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      {/* One region, not a card count: nothing here claims how the page is
          divided, only that something is loading into the space it will use. */}
      <Skeleton className="min-h-0 w-full flex-1 rounded-lg" />
    </div>
  )
}
