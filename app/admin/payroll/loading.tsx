import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { Skeleton } from '@/components/ui/skeleton'

export default function PayrollLoading() {
  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]" aria-label="Loading payroll">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-9 w-[520px] max-w-full" />
      <Skeleton className="h-96 rounded-lg" />
    </AdminPageShell>
  )
}
