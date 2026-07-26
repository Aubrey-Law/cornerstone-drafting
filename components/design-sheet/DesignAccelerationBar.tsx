'use client'

import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { DesignSheetOnChange } from '@/app/admin/drafting/[matterId]/design/sections/shared'
import type { DesignReadinessBlocker } from '@/lib/designSheetReadiness'
import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { useUserPreferences } from '@/lib/userPreferencesClient'
import type { AttorneyDesignPreset } from '@/lib/designSheet/fastEntryWorkflow'
import {
  applyAttorneyPreset,
  buildAttorneyPreset,
  buildCopyClientToSpousePatch,
  buildTrusteesToPrimaryRolesPatch,
  previewAttorneyPreset,
} from '@/lib/designSheet/fastEntryWorkflow'
import type { DesignSheet } from '@/types/database'

export interface DesignAccelerationBarProps {
  sheet: DesignSheet
  updateField: DesignSheetOnChange
  documentInclusions: DesignDocumentInclusions
  nextRequired: DesignReadinessBlocker | null
  onNextRequired: (blocker: DesignReadinessBlocker) => void
  showLayoutControls?: boolean
  showCompleted?: boolean
  expandAll?: boolean
  onShowCompletedChange?: (value: boolean) => void
  onExpandAllChange?: (value: boolean) => void
  attorneyPreset: AttorneyDesignPreset | null
  onAttorneyPresetChange: (preset: AttorneyDesignPreset) => void
  /**
   * `bar` is the full fast-entry toolbar. `slim` and `inline` collapse the shortcuts
   * into a dropdown and show only the next-required control; `inline` drops the card
   * chrome so the row can sit inside the guided overview intro card.
   */
  variant?: 'bar' | 'slim' | 'inline'
}

export function DesignAccelerationBar({
  sheet,
  updateField,
  documentInclusions,
  nextRequired,
  onNextRequired,
  showLayoutControls = false,
  showCompleted = false,
  expandAll = false,
  onShowCompletedChange,
  onExpandAllChange,
  attorneyPreset,
  onAttorneyPresetChange,
  variant = 'bar',
}: DesignAccelerationBarProps) {
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [overwritePresetConflicts, setOverwritePresetConflicts] = useState(false)
  const { savePreferences } = useUserPreferences()

  const applyPatch = useCallback((patch: Partial<DesignSheet>) => {
    for (const [field, value] of Object.entries(patch)) {
      updateField(field as keyof DesignSheet, value as DesignSheet[keyof DesignSheet])
    }
  }, [updateField])

  const presetPreview = useMemo(
    () => attorneyPreset ? previewAttorneyPreset(sheet, attorneyPreset) : [],
    [attorneyPreset, sheet],
  )

  const handleSavePreset = useCallback(async () => {
    const preset = buildAttorneyPreset(sheet)
    if (Object.keys(preset.fields).length === 0) {
      toast.error('Complete at least one standard structural choice first.')
      return
    }
    const saved = await savePreferences({ drafting: { attorneyPreset: preset } })
    if (!saved) {
      toast.error('Unable to save your standard choices.')
      return
    }
    onAttorneyPresetChange(preset)
    toast.success('Standard choices saved for future matters.')
  }, [onAttorneyPresetChange, savePreferences, sheet])

  const handleApplyPreset = useCallback(() => {
    if (!attorneyPreset) return
    const patch = applyAttorneyPreset(sheet, attorneyPreset, { overwrite: overwritePresetConflicts })
    applyPatch(patch)
    setPresetDialogOpen(false)
    setOverwritePresetConflicts(false)
    toast.success(`Applied ${Object.keys(patch).length} standard choice${Object.keys(patch).length === 1 ? '' : 's'}.`)
  }, [applyPatch, attorneyPreset, overwritePresetConflicts, sheet])

  const shortcuts = [
    {
      key: 'apply-standards',
      label: 'Apply my standards',
      description: attorneyPreset
        ? 'Fill structural choices from your saved defaults.'
        : 'Save a set of standards first.',
      disabled: !attorneyPreset,
      // Let the menu finish closing before the dialog claims focus.
      onSelect: () => { window.setTimeout(() => setPresetDialogOpen(true), 0) },
    },
    {
      key: 'save-standards',
      label: 'Save current as my standards',
      description: 'Reuse this matter’s structural choices on future matters.',
      disabled: false,
      onSelect: () => { void handleSavePreset() },
    },
    {
      key: 'copy-spouse',
      label: 'Copy client selections to spouse',
      description: 'Mirror the client’s document choices onto the spouse set.',
      disabled: !documentInclusions.spouse_docs,
      onSelect: () => applyPatch(buildCopyClientToSpousePatch(sheet)),
    },
    {
      key: 'trustees-primary',
      label: 'Copy trustees into primary roles',
      description: 'Nominate the trustees as executor and agent as well.',
      disabled: !documentInclusions.trust,
      onSelect: () => applyPatch(buildTrusteesToPrimaryRolesPatch(sheet, documentInclusions)),
    },
  ]

  const nextRequiredControl = nextRequired ? (
    <Button size="sm" className="gap-1.5 text-xs" onClick={() => onNextRequired(nextRequired)}>
      Next: {nextRequired.label}
      <ChevronRight className="h-3.5 w-3.5" />
    </Button>
  ) : (
    <Badge className="border-0 bg-success/10 text-success"><Check className="mr-1 h-3 w-3" />Ready to generate</Badge>
  )

  const shortcutsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <WandSparkles className="h-3.5 w-3.5" />
          Shortcuts
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {shortcuts.map(shortcut => (
          <DropdownMenuItem
            key={shortcut.key}
            disabled={shortcut.disabled}
            onSelect={shortcut.onSelect}
            className="flex-col items-start gap-0.5"
          >
            <span className="text-xs font-medium">{shortcut.label}</span>
            <span className="text-[11px] text-muted-foreground">{shortcut.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Apply my standard choices</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Only allowlisted structural choices are included. Client elections and intake identity fields are never preset.</p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {presetPreview.length === 0 ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">No changes are needed.</p>
            ) : presetPreview.map(item => (
              <div key={item.field} className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium capitalize">{item.field.replace(/_/g, ' ')}</p>
                  {item.conflict && <p className="text-xs text-warning">Existing value will be kept unless overwrite is selected.</p>}
                </div>
                <span className="text-right text-xs text-muted-foreground">{String(item.presetValue)}</span>
              </div>
            ))}
          </div>
          {presetPreview.some(item => item.conflict) && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={overwritePresetConflicts} onCheckedChange={value => setOverwritePresetConflicts(value === true)} />
              Replace existing structural choices shown above
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPresetDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleApplyPreset} disabled={presetPreview.length === 0}>Apply choices</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {variant !== 'bar' ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            variant === 'slim' && 'mb-3 rounded-lg border border-border bg-card px-3 py-2',
          )}
        >
          {nextRequiredControl}
          {shortcutsMenu}
        </div>
      ) : (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        {nextRequired ? (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => onNextRequired(nextRequired)}>
            <ChevronRight className="h-3.5 w-3.5" />Next required: {nextRequired.label}
          </Button>
        ) : (
          <Badge className="border-0 bg-success/10 text-success"><Check className="mr-1 h-3 w-3" />Ready to generate</Badge>
        )}
        {showLayoutControls && (
          <>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => onExpandAllChange?.(!expandAll)}>
              {expandAll ? 'Collapse completed' : 'Expand all'}
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={showCompleted} onCheckedChange={value => onShowCompletedChange?.(value === true)} />Show completed
            </label>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          </>
        )}
        {attorneyPreset && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setPresetDialogOpen(true)}>
            <WandSparkles className="h-3.5 w-3.5" />Apply my standards
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => void handleSavePreset()}>Save current as my standards</Button>
        {documentInclusions.spouse_docs && (
          <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPatch(buildCopyClientToSpousePatch(sheet))}>Client selections → spouse</Button>
        )}
        {documentInclusions.trust && (
          <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPatch(buildTrusteesToPrimaryRolesPatch(sheet, documentInclusions))}>Trustees → primary roles</Button>
        )}
      </div>
      )}
    </>
  )
}
