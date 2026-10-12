import { cn } from '@/lib/utils'
import type { PlanData } from './types'

export function LoadIndicator({ day, count, pending = false }: { day?: PlanData['days'][number]; count: number; pending?: boolean }) {
  // A missing day while the week is still loading, or after Google failed, is
  // one page-level message — not a failure stamped on every column.
  if (pending || !day) return null
  const total = day.clientMinutes + day.internalMinutes
  const over = day.targetMinutes > 0 && total > day.targetMinutes
  return <div title={`${total} minutes total · ${day.targetMinutes} minute target`}>
    {day.targetMinutes > 0 && <div className="my-1 h-1 overflow-hidden rounded bg-muted"><div className={cn('h-full', over ? 'bg-amber' : 'bg-primary')} style={{ width: `${Math.min(100, total / day.targetMinutes * 100)}%` }} /></div>}
    <span className={cn('block text-micro', over ? 'text-amber' : 'text-muted-foreground')}>{Math.round(day.clientMinutes / 60 * 10) / 10}h client · {count} appts{over ? ' · over target' : day.targetMinutes <= 0 ? ' · no target' : ''}</span>
  </div>
}

