'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WeeklyHours, Weekday } from '@/lib/appointments/types'

export const WEEKDAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

interface WeeklyHoursEditorProps {
  value: WeeklyHours
  onChange: (next: WeeklyHours) => void
  /** Compact rows for nested contexts (per-appointment-type hours). */
  compact?: boolean
}

export function WeeklyHoursEditor({ value, onChange, compact }: WeeklyHoursEditorProps) {
  function updateWindow(day: Weekday, index: number, field: 'start' | 'end', v: string) {
    const windows = [...(value[day] ?? [])]
    windows[index] = { ...windows[index], [field]: v }
    onChange({ ...value, [day]: windows })
  }

  function addWindow(day: Weekday) {
    onChange({ ...value, [day]: [...(value[day] ?? []), { start: '09:00', end: '17:00' }] })
  }

  function removeWindow(day: Weekday, index: number) {
    onChange({ ...value, [day]: (value[day] ?? []).filter((_, i) => i !== index) })
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {WEEKDAY_ORDER.map(day => (
        <div key={day} className="flex flex-wrap items-center gap-2">
          <span className={`${compact ? 'w-20 text-xs' : 'w-24 text-sm'} text-foreground`}>
            {compact ? WEEKDAY_LABELS[day].slice(0, 3) : WEEKDAY_LABELS[day]}
          </span>
          {(value[day] ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">Unavailable</span>
          )}
          {(value[day] ?? []).map((w, i) => (
            <span key={i} className="flex items-center gap-1">
              <Input
                type="time"
                className={compact ? 'h-7 w-24 text-xs' : 'h-8 w-28'}
                value={w.start}
                onChange={e => updateWindow(day, i, 'start', e.target.value)}
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="time"
                className={compact ? 'h-7 w-24 text-xs' : 'h-8 w-28'}
                value={w.end}
                onChange={e => updateWindow(day, i, 'end', e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeWindow(day, i)}
              >
                ✕
              </Button>
            </span>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => addWindow(day)}>
            + Add
          </Button>
        </div>
      ))}
    </div>
  )
}
