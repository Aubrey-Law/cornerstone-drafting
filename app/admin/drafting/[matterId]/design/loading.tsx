export default function DesignSheetLoading() {
  return (
    <div className="-mx-4 -mb-4 flex min-h-full flex-col bg-background md:-mx-6 md:-mb-6">
      {/* Subheader */}
      <div className="flex flex-col gap-3 border-b border-border bg-card px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 animate-pulse rounded bg-border" />
          <div className="h-4 w-48 animate-pulse rounded bg-border" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-24 animate-pulse rounded bg-border" />
          <div className="h-7 w-16 animate-pulse rounded bg-border" />
          <div className="h-7 w-20 animate-pulse rounded bg-border" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <nav className="hidden w-[216px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-card p-2 md:flex">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded px-3 py-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-border" />
              <div className="h-3 w-20 animate-pulse rounded bg-border" />
            </div>
          ))}
        </nav>

        {/* Form content */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-2xl space-y-6">
            {/* Section title */}
            <div className="h-5 w-32 animate-pulse rounded bg-border" />

            {/* Field rows */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-24 animate-pulse rounded bg-border" />
                <div className="h-9 w-full animate-pulse rounded-md bg-border" />
              </div>
            ))}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="h-3 w-20 animate-pulse rounded bg-border" />
                  <div className="h-9 w-full animate-pulse rounded-md bg-border" />
                </div>
              ))}
            </div>

            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-28 animate-pulse rounded bg-border" />
                <div className="h-9 w-full animate-pulse rounded-md bg-border" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
