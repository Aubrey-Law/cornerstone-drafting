export default function DraftingHubLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 animate-pulse rounded bg-border" />
          <div className="h-4 w-64 animate-pulse rounded bg-border" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-md bg-border" />
          <div className="h-9 w-24 animate-pulse rounded-md bg-border" />
        </div>
      </div>

      <div className="h-10 w-full max-w-md animate-pulse rounded-md bg-border" />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-border" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-border" />
            <div className="h-3 w-full animate-pulse rounded bg-border" />
            <div className="flex gap-2 pt-2">
              <div className="h-6 w-16 animate-pulse rounded bg-border" />
              <div className="h-6 w-20 animate-pulse rounded bg-border" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
