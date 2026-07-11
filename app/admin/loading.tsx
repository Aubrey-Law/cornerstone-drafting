import { Skeleton } from '@/components/ui/skeleton'

export default function AdminTodayLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <div>
        <Skeleton className="h-6 w-24" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-3 px-4 py-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}
