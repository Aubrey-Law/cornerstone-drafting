'use client'

interface RecordSectionOption<T extends string> {
  value: T
  label: string
}

interface MobileRecordSectionSelectProps<T extends string> {
  label: string
  value: T
  options: readonly RecordSectionOption<T>[]
  onValueChange: (value: T) => void
}

/** Native mobile section picker that controls the same URL-backed state as desktop tabs. */
export function MobileRecordSectionSelect<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: MobileRecordSectionSelectProps<T>) {
  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-border bg-background p-2 shadow-xs md:hidden">
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="shrink-0">Section</span>
        <select
          aria-label={label}
          value={value}
          onChange={event => onValueChange(event.target.value as T)}
          className="h-10 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/60"
        >
          {options.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
