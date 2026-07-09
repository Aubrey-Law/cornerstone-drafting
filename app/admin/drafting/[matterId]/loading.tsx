export default function DraftingWorkspaceLoading() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-border" />
          <div className="h-7 w-56 animate-pulse rounded bg-border" />
          <div className="h-3 w-40 animate-pulse rounded bg-border" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-md bg-border" />
          <div className="h-9 w-24 animate-pulse rounded-md bg-border" />
        </div>
      </div>

      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-28 animate-pulse rounded-md bg-border" />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mx-auto max-w-2xl space-y-5">
          <div className="h-5 w-40 animate-pulse rounded bg-border" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-border" />
              <div className="h-9 w-full animate-pulse rounded-md bg-border" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
