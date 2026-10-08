'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { IntakeFormEditorSnapshot } from '@/lib/intake/forms/persistenceTypes'
import type { IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'
import type { IntakeFormDiagnostic } from '@/lib/intake/forms/compiler'
import { addItem, addSection, moveItem, moveSection, removeItem, removeSection, selectionAfterRemoval, targetForDiagnostic, updateItem, updateSection, type EditorSelection } from '@/lib/intake/forms/editorState'
import { IntakeFormOutline } from './IntakeFormOutline'
import { IntakeFormInspector } from './IntakeFormInspector'
import { IntakeCatalogDrawer } from './IntakeCatalogDrawer'
import { IntakeFormDiagnostics } from './IntakeFormDiagnostics'
import { useIntakeFormDraft } from './useIntakeFormDraft'
import { IntakeFormPreview } from './IntakeFormPreview'

function subscribeLayout(callback: () => void) {
  const media = window.matchMedia?.('(min-width: 768px)')
  media?.addEventListener('change', callback)
  return () => media?.removeEventListener('change', callback)
}
const wideLayout = () => window.matchMedia?.('(min-width: 768px)').matches ?? false
const serverLayout = () => false

export function IntakeFormEditorClient({ initialSnapshot, catalog }: { initialSnapshot: IntakeFormEditorSnapshot; catalog: IntakeFormBuilderCatalog }) {
  const draft = useIntakeFormDraft(initialSnapshot)
  const { snapshot, localDefinition, readOnly, dirty, diagnostics } = draft
  const [selection, setSelection] = useState<EditorSelection>({ kind: 'form' })
  const [mode, setMode] = useState<'build' | 'preview'>('build')
  const [catalogSection, setCatalogSection] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Exclude<EditorSelection, { kind: 'form' }> | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'discard' | 'retire' | 'reload' | null>(null)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const wide = useSyncExternalStore(subscribeLayout, wideLayout, serverLayout)
  function change(next: IntakeFormDefinition) { draft.changeDefinition(next) }
  function rememberFocus() { dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
  function restoreFocus() {
    const target = dialogTrigger.current?.isConnected ? dialogTrigger.current : document.getElementById(`intake-builder-${selection.kind}-heading`)
    target?.focus()
  }
  function move(itemId: string, toSectionId: string, toIndex: number) {
    const target = localDefinition.sections.find(section => section.id === toSectionId)
    if (!target || (!target.items.some(item => item.id === itemId) && target.items.length >= 100)) return
    change(moveItem(localDefinition, { itemId, toSectionId, toIndex }))
    if (selection.kind === 'item' && selection.itemId === itemId) setSelection({ ...selection, sectionId: toSectionId })
  }
  function navigate(diagnostic: IntakeFormDiagnostic) {
    const target = targetForDiagnostic(diagnostic.path, localDefinition)
    setMode('build'); setSelection(target)
    requestAnimationFrame(() => {
      const control = target.control === 'config' ? 'config-profile' : target.control
      const element = document.getElementById(`intake-builder-${target.kind}-${control}`) ?? document.getElementById(`intake-builder-${target.kind}-heading`)
      element?.focus(); element?.scrollIntoView({ block: 'nearest' })
    })
  }
  const inspector = <IntakeFormInspector definition={localDefinition} catalog={catalog} selection={selection} readOnly={readOnly}
    onFormChange={patch => change({ ...localDefinition, ...patch })} onSectionChange={(id, patch) => change(updateSection(localDefinition, id, patch))}
    onItemChange={(id, patch) => change(updateItem(localDefinition, id, patch))} onMoveItem={move} />
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link href="/admin/settings/intake-forms" className="text-sm text-muted-foreground underline">Intake forms</Link><h1 className="text-2xl font-semibold">{snapshot.template.name}</h1>{draft.version && <p className="text-sm text-muted-foreground">Version {draft.version.version} · {draft.version.status}</p>}</div>
      <p role="status" className="text-sm text-muted-foreground">{draft.busy ? 'Saving changes…' : dirty ? 'Unsaved changes' : readOnly ? 'Read-only version' : 'No unsaved changes'}</p>
    </div>
    <div role="group" aria-label="Form actions" className="flex flex-wrap gap-2">
      {snapshot.draft ? <>
        <Button disabled={readOnly || draft.saveStatus === 'conflict' || (!dirty && draft.saveStatus !== 'error')} onClick={() => void draft.saveDraft()}>{draft.saveStatus === 'error' ? 'Retry save' : 'Save draft'}</Button>
        <Button variant="outline" disabled={!draft.canPublish} onClick={() => { rememberFocus(); setConfirming('publish') }}>Publish</Button>
        <Button variant="outline" disabled={draft.busy || Boolean(snapshot.template.archived_at)} onClick={() => { rememberFocus(); setConfirming('discard') }}>Discard draft</Button>
      </> : <>
        <Button disabled={!draft.version || draft.busy || Boolean(snapshot.template.archived_at) || draft.saveStatus === 'conflict'} onClick={() => void draft.createNextDraft()}>Edit</Button>
        {draft.version?.status === 'published' && <Button variant="outline" disabled={draft.busy || draft.saveStatus === 'conflict'} onClick={() => { rememberFocus(); setConfirming('retire') }}>Retire</Button>}
      </>}
    </div>
    {snapshot.template.archived_at && <p className="text-sm text-muted-foreground">Restore this template from Intake forms before editing or creating a draft.</p>}
    {draft.error && <div role="alert" className="rounded-lg border border-destructive p-4"><p>{draft.error}</p>
      <div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" disabled={draft.busy} onClick={() => { rememberFocus(); setConfirming('reload') }}>Reload latest</Button>
        <Button variant="outline" onClick={() => void draft.copyLocalDefinition()}>Copy local definition</Button></div>
    </div>}
    {draft.notice && <p role="status">{draft.notice}</p>}
    <div role="group" aria-label="Editor mode" className="flex gap-2"><Button variant={mode === 'build' ? 'default' : 'outline'} aria-pressed={mode === 'build'} onClick={() => setMode('build')}>Build</Button><Button variant={mode === 'preview' ? 'default' : 'outline'} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</Button></div>
    {mode === 'build' ? <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <IntakeFormOutline definition={localDefinition} catalog={catalog} selection={selection} onSelect={setSelection} readOnly={readOnly} inlineInspector={wide ? undefined : inspector}
        onAddSection={() => { const next = addSection(localDefinition, { title: 'New section', audience: 'client_and_staff' }); change(next); setSelection({ kind: 'section', sectionId: next.sections.at(-1)!.id }) }}
        onAddItem={id => { rememberFocus(); setCatalogSection(id) }} onRemove={target => { rememberFocus(); setRemoving(target) }} onMoveSection={(id, index) => change(moveSection(localDefinition, id, index))} onMoveItem={move} />
      {wide && <div className="sticky top-4 min-w-0 max-h-[calc(100vh-2rem)] overflow-auto">{inspector}</div>}
    </div> : <IntakeFormPreview localDefinition={localDefinition} />}
    <IntakeFormDiagnostics diagnostics={diagnostics} definition={localDefinition} catalog={catalog} onNavigate={navigate} />
    <IntakeCatalogDrawer definition={localDefinition} catalog={catalog} sectionId={catalogSection} onRestoreFocus={restoreFocus} onClose={() => setCatalogSection(null)} onAdd={item => {
      if (!catalogSection) return
      const next = addItem(localDefinition, catalogSection, item)
      change(next); setSelection({ kind: 'item', sectionId: catalogSection, itemId: next.sections.find(section => section.id === catalogSection)!.items.at(-1)!.id }); setCatalogSection(null)
    }} />
    <AlertDialog open={draft.confirmingDeparture} onOpenChange={open => { if (!open) draft.cancelDeparture() }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); draft.restoreDepartureFocus() }}>
      <AlertDialogHeader><AlertDialogTitle>Leave without saving?</AlertDialogTitle><AlertDialogDescription>You have unsaved intake form changes. Leave without saving them?</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={draft.confirmDeparture}>Leave</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(removing)} onOpenChange={open => { if (!open) setRemoving(null) }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus() }}>
      <AlertDialogHeader><AlertDialogTitle>Remove {removing?.kind === 'section' ? 'section and its items' : 'item'}?</AlertDialogTitle><AlertDialogDescription>This changes only this draft. Conditions elsewhere may need updating.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => {
        if (!removing) return
        const next = removing.kind === 'section' ? removeSection(localDefinition, removing.sectionId) : removeItem(localDefinition, removing.itemId)
        change(next); setSelection(selectionAfterRemoval(localDefinition, next, selection)); setRemoving(null)
      }}>Confirm removal</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(confirming)} onOpenChange={open => { if (!open) setConfirming(null) }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus() }}>
      <AlertDialogHeader><AlertDialogTitle>{confirming === 'reload' ? 'Reload latest' : confirming === 'publish' ? 'Publish' : confirming === 'discard' ? 'Discard draft' : 'Retire'}?</AlertDialogTitle>
        <AlertDialogDescription>{snapshot.template.name}, version {draft.version?.version ?? 'new'}. {confirming === 'publish' ? 'Publishing makes this version immutable. Future edits require a new draft.' : confirming === 'discard' ? 'This permanently removes this draft and its unsaved changes. Published and retired versions remain available.' : confirming === 'retire' ? 'This version will no longer be available for future selection. Historical and pinned references remain available.' : 'Reloading replaces your local changes with the latest saved version. Copy your local definition first if you need to keep it.'}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => {
        const action = confirming; setConfirming(null)
        if (action === 'publish') void draft.publishDraft()
        else if (action === 'discard') void draft.discardDraft().then(success => { if (success) setSelection({ kind: 'form' }) })
        else if (action === 'retire') void draft.retireVersion()
        else if (action === 'reload') void draft.reloadLatest().then(success => { if (success) setSelection({ kind: 'form' }) })
      }}>Confirm {confirming}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>
}
