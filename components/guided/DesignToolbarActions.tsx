'use client'

import { Braces, ChevronDown, Copy, Download, Loader2, Upload } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { guidedSecondaryButtonStyle } from './styles'

interface DesignToolbarActionsProps {
  /** Opens the "copy plan structure from another matter" picker. */
  onClonePlan?: () => void
  onImport: () => void
  onSave: () => void
  onExport: () => void
  /** Downloads the raw generator-data JSON consumed by external drafting tooling. */
  onExportJson?: () => void
  /** Downloads the generator data wrapped in a .docx, the envelope Mike's uploads accept. */
  onExportJsonDocx?: () => void
  saveLabel: string
  saving: boolean
  exporting: boolean
  pending: boolean
  saveDirty: boolean
  /** Autosave is primary; hide the manual action while the sheet is healthy. */
  showSave?: boolean
  /**
   * Collapses clone/import/export into a single `Import ▾` menu and drops the manual
   * save button — the autosave pill is then the only save affordance.
   */
  collapsed?: boolean
}

export function DesignToolbarActions({
  onClonePlan,
  onImport,
  onSave,
  onExport,
  onExportJson,
  onExportJsonDocx,
  saveLabel,
  saving,
  exporting,
  pending,
  saveDirty,
  showSave = true,
  collapsed = false,
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

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={pending} style={btnStyle()}>
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Import
            <ChevronDown size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {onClonePlan && (
            <DropdownMenuItem onSelect={onClonePlan} className="text-xs">
              <Copy size={14} />
              Clone from another matter
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onImport} className="text-xs">
            <Upload size={14} />
            Import design sheet
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport} disabled={exporting} className="text-xs">
            <Download size={14} />
            Export design sheet
          </DropdownMenuItem>
          {onExportJson && (
            <DropdownMenuItem onSelect={onExportJson} disabled={exporting} className="text-xs">
              <Braces size={14} />
              Export generator data (JSON)
            </DropdownMenuItem>
          )}
          {onExportJsonDocx && (
            <DropdownMenuItem onSelect={onExportJsonDocx} disabled={exporting} className="text-xs">
              <Braces size={14} />
              Export generator data for Mike (.docx)
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

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
      {showSave && (
        <button type="button" onClick={onSave} disabled={pending || saving} style={btnStyle(saveDirty)}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saveLabel}
        </button>
      )}
      <button type="button" onClick={onExport} disabled={pending || exporting} style={btnStyle()}>
        {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        Export
      </button>
      {onExportJson && (
        <button type="button" onClick={onExportJson} disabled={pending || exporting} style={btnStyle()}>
          <Braces size={14} />
          JSON
        </button>
      )}
    </>
  )
}
