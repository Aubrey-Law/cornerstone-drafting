'use client'

import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { compareDesignSheets, type ConflictChoices, type DesignSheetConflict } from '@/lib/designSheet/designSheetConflict'

function display(value: unknown): string {
  if (value == null || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.length ? value.map(display).join('\n\n') : 'None'
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.replaceAll('_', ' ')}: ${display(item)}`).join('\n')
  return String(value)
}

export function DesignSheetConflictDialog({ conflict, saving, onResolve, onReload }: {
  conflict: DesignSheetConflict
  saving: boolean
  onResolve: (choices: ConflictChoices) => Promise<boolean>
  onReload: () => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  const [choices, setChoices] = useState<ConflictChoices>({})
  const differences = useMemo(() => conflict.latest ? compareDesignSheets(conflict.local, conflict.latest) : [], [conflict])
  const complete = Boolean(conflict.latest) && differences.every(d => choices[d.path])
  return <>
    <div role="alert" className="flex items-center justify-between gap-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p>Editing and autosave are paused. Your unsaved changes are preserved in this tab until you resolve the saved versions.</p>
      <Button variant="outline" onClick={() => setOpen(true)}>Review versions</Button>
    </div>
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next) }}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!saving} onEscapeKeyDown={event => { if (saving) event.preventDefault() }} onInteractOutside={event => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Resolve design sheet changes</DialogTitle>
          <DialogDescription>Another saved version is available. Choose which value to keep for every difference, including changes made elsewhere. Editing and autosave stay paused if you close this review. Your recovery copy is stored in this browser tab.</DialogDescription>
        </DialogHeader>
        {conflict.error && <p role="alert" className="text-sm text-destructive">{conflict.error}</p>}
        {!conflict.latest ? <Button onClick={() => void onReload()}>Load latest saved version</Button> : <>
          {differences.length === 0 && <p>The editable values match. Confirm to resume editing with the latest saved version.</p>}
          {differences.map(difference => <fieldset key={difference.path} disabled={saving} className="min-w-0 rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold capitalize">{difference.label}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['local', 'latest'] as const).map(side => <label key={side} className="min-w-0 cursor-pointer rounded border p-3 text-sm">
                <span className="flex items-center gap-2 font-medium"><input type="radio" name={`conflict-${difference.path}`} value={side} checked={choices[difference.path] === side} onChange={() => setChoices(previous => ({ ...previous, [difference.path]: side }))} />{side === 'local' ? 'Your changes' : 'Latest saved changes'}</span>{' '}
                <span className="mt-2 block whitespace-pre-wrap break-words">{display(difference[side])}</span>
              </label>)}
            </div>
          </fieldset>)}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Review later</Button>
            <Button disabled={!complete || saving} onClick={() => void onResolve(choices)}>{saving ? 'Saving resolution…' : 'Save selected values'}</Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </>
}
