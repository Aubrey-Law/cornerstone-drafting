import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="hidden h-96 w-full lg:block" />
      </div>
    </div>
  )
}
