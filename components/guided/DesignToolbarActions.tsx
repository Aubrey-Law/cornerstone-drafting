'use client'

import { Copy, Download, Loader2, Upload } from 'lucide-react'
import { guidedSecondaryButtonStyle } from './styles'

interface DesignToolbarActionsProps {
  /** Opens the "copy plan structure from another matter" picker. */
  onClonePlan?: () => void
  onImport: () => void
  onSave: () => void
  onExport: () => void
  saveLabel: string
  saving: boolean
  exporting: boolean
  pending: boolean
  saveDirty: boolean
}

export function DesignToolbarActions({
  onClonePlan,
  onImport,
  onSave,
  onExport,
  saveLabel,
  saving,
  exporting,
  pending,
  saveDirty,
}: DesignToolbarActionsProps) {
  const btnStyle = (emphasis = false) => ({
    ...guidedSecondaryButtonStyle,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: emphasis ? 'var(--gi-teal)' : 'transparent',
    color: emphasis ? '#fff' : 'var(--gi-teal)',
    border: emphasis ? 'none' : guidedSecondaryButtonStyle.border,
    opacity: pending ? 0.6 : 1,
  })

  return (
    <>
      {onClonePlan && (
        <button type="button" onClick={onClonePlan} disabled={pending} style={btnStyle()}>
          <Copy size={14} />
          Copy plan
        </button>
      )}
      <button type="button" onClick={onImport} disabled={pending} style={btnStyle()}>
        <Upload size={14} />
        Import
      </button>
      <button type="button" onClick={onSave} disabled={pending || saving} style={btnStyle(saveDirty)}>
        {saving && <Loader2 size={14} className="animate-spin" />}
        {saveLabel}
      </button>
      <button type="button" onClick={onExport} disabled={pending || exporting} style={btnStyle()}>
        {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        Export
      </button>
    </>
  )
}
