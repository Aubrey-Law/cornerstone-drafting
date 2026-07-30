'use client'

export type GuidedSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'dirty'

interface AutosavePillProps {
  saveStatus: GuidedSaveStatus
  dirtyLabel?: string
  savedLabel?: string
}

export function AutosavePill({
  saveStatus,
  dirtyLabel = 'Unsaved changes',
  savedLabel = 'Autosaved',
}: AutosavePillProps) {
  const label = saveStatus === 'saving'
    ? 'Saving…'
    : saveStatus === 'error'
      ? 'Save error'
      : saveStatus === 'dirty'
        ? dirtyLabel
        : savedLabel
  const tone = saveStatus === 'error'
    ? 'border-destructive/30 bg-destructive/10 text-destructive'
    : saveStatus === 'dirty'
      ? 'border-warning/30 bg-warning/10 text-warning'
      : 'border-success/30 bg-success/10 text-success'
  const dot = saveStatus === 'error'
    ? 'bg-destructive'
    : saveStatus === 'dirty'
      ? 'bg-warning'
      : 'bg-success'

  return (
    <span className={`inline-flex items-center gap-[7px] rounded-full border px-3 py-1.5 text-xs font-semibold leading-none ${tone}`}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${dot}`}
        style={{ animation: saveStatus === 'saving' ? 'gi-pulse 2s ease-in-out infinite' : undefined }}
      />
      {label}
    </span>
  )
}
