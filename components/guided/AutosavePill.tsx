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
  const color = saveStatus === 'error' ? '#b91c1c' : saveStatus === 'dirty' ? '#92400e' : '#15803d'
  const bg = saveStatus === 'error' ? '#fef2f2' : saveStatus === 'dirty' ? '#fffbeb' : '#f0fdf4'
  const border = saveStatus === 'error' ? '#fecaca' : saveStatus === 'dirty' ? '#fcd34d' : '#a7f3d0'
  const dot = saveStatus === 'error' ? '#dc2626' : saveStatus === 'dirty' ? '#d97706' : '#16a34a'

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      font: '600 12px/1 var(--gi-sans)',
      color,
      background: bg,
      border: `1px solid ${border}`,
      padding: '6px 12px',
      borderRadius: 999,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: dot,
        animation: saveStatus === 'saving' ? 'gi-pulse 2s ease-in-out infinite' : undefined,
      }} />
      {label}
    </span>
  )
}
