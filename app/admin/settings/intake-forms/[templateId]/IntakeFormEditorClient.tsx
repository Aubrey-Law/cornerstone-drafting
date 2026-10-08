'use client'

import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { IntakeFormEditorSnapshot } from '@/lib/intake/forms/persistenceTypes'
import type { IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'
import { compileIntakeForm, type IntakeFormDiagnostic } from '@/lib/intake/forms/compiler'
import { addItem, addSection, createBlankDefinition, definitionFingerprint, moveItem, moveSection, removeItem, removeSection, selectionAfterRemoval, targetForDiagnostic, updateItem, updateSection, type EditorSelection } from '@/lib/intake/forms/editorState'
import { IntakeFormOutline } from './IntakeFormOutline'
import { IntakeFormInspector } from './IntakeFormInspector'
import { IntakeCatalogDrawer } from './IntakeCatalogDrawer'
import { IntakeFormDiagnostics } from './IntakeFormDiagnostics'

function subscribeLayout(callback: () => void) {
  const media = window.matchMedia?.('(min-width: 768px)')
  media?.addEventListener('change', callback)
  return () => media?.removeEventListener('change', callback)
}
const wideLayout = () => window.matchMedia?.('(min-width: 768px)').matches ?? false
const serverLayout = () => false

export function IntakeFormEditorClient({ initialSnapshot, catalog }: { initialSnapshot: IntakeFormEditorSnapshot; catalog: IntakeFormBuilderCatalog }) {
  const initialDefinition = initialSnapshot.draft?.definition ?? initialSnapshot.versions[0]?.definition ?? createBlankDefinition({ key: initialSnapshot.template.key, title: initialSnapshot.template.name })
  const [localDefinition, setLocalDefinition] = useState<IntakeFormDefinition>(initialDefinition)
  const [savedDefinition] = useState<IntakeFormDefinition>(initialDefinition)
  const [selection, setSelection] = useState<EditorSelection>({ kind: 'form' })
  const [mode, setMode] = useState<'build' | 'preview'>('build')
  const [catalogSection, setCatalogSection] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Exclude<EditorSelection, { kind: 'form' }> | null>(null)
  const dialogTrigger = useRef<HTMLElement | null>(null)
  const wide = useSyncExternalStore(subscribeLayout, wideLayout, serverLayout)
  const readOnly = !initialSnapshot.draft || Boolean(initialSnapshot.template.archived_at)
  const dirty = definitionFingerprint(localDefinition) !== definitionFingerprint(savedDefinition)
  const diagnostics = useMemo(() => {
    const unique = new Map<string, IntakeFormDiagnostic>()
    for (const audience of ['client', 'staff'] as const) {
      const result = compileIntakeForm(localDefinition, audience)
      if (!result.success) for (const diagnostic of result.errors) unique.set(JSON.stringify([diagnostic.path, diagnostic.message]), diagnostic)
    }
    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }) || a.message.localeCompare(b.message, 'en'))
  }, [localDefinition])
  function change(next: IntakeFormDefinition) { if (!readOnly) setLocalDefinition(next) }
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
      <div><Link href="/admin/settings/intake-forms" className="text-sm text-muted-foreground underline">Intake forms</Link><h1 className="text-2xl font-semibold">{initialSnapshot.template.name}</h1></div>
      <p role="status" className="text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : readOnly ? 'Read-only version' : 'No unsaved changes'}</p>
    </div>
    <div role="group" aria-label="Editor mode" className="flex gap-2"><Button variant={mode === 'build' ? 'default' : 'outline'} aria-pressed={mode === 'build'} onClick={() => setMode('build')}>Build</Button><Button variant={mode === 'preview' ? 'default' : 'outline'} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</Button></div>
    {mode === 'build' ? <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      <IntakeFormOutline definition={localDefinition} catalog={catalog} selection={selection} onSelect={setSelection} readOnly={readOnly} inlineInspector={wide ? undefined : inspector}
        onAddSection={() => { const next = addSection(localDefinition, { title: 'New section', audience: 'client_and_staff' }); change(next); setSelection({ kind: 'section', sectionId: next.sections.at(-1)!.id }) }}
        onAddItem={id => { rememberFocus(); setCatalogSection(id) }} onRemove={target => { rememberFocus(); setRemoving(target) }} onMoveSection={(id, index) => change(moveSection(localDefinition, id, index))} onMoveItem={move} />
      {wide && <div className="sticky top-4 min-w-0 max-h-[calc(100vh-2rem)] overflow-auto">{inspector}</div>}
    </div> : <section aria-label="Form preview" className="rounded-lg border p-4"><h2 className="font-medium">Preview</h2><p className="text-sm text-muted-foreground">The read-only questionnaire preview is coming in the next builder step.</p></section>}
    <IntakeFormDiagnostics diagnostics={diagnostics} definition={localDefinition} catalog={catalog} onNavigate={navigate} />
    <IntakeCatalogDrawer definition={localDefinition} catalog={catalog} sectionId={catalogSection} onRestoreFocus={restoreFocus} onClose={() => setCatalogSection(null)} onAdd={item => {
      if (!catalogSection) return
      const next = addItem(localDefinition, catalogSection, item)
      change(next); setSelection({ kind: 'item', sectionId: catalogSection, itemId: next.sections.find(section => section.id === catalogSection)!.items.at(-1)!.id }); setCatalogSection(null)
    }} />
    <AlertDialog open={Boolean(removing)} onOpenChange={open => { if (!open) setRemoving(null) }}><AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus() }}>
      <AlertDialogHeader><AlertDialogTitle>Remove {removing?.kind === 'section' ? 'section and its items' : 'item'}?</AlertDialogTitle><AlertDialogDescription>This changes only this draft. Conditions elsewhere may need updating.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => {
        if (!removing) return
        const next = removing.kind === 'section' ? removeSection(localDefinition, removing.sectionId) : removeItem(localDefinition, removing.itemId)
        change(next); setSelection(selectionAfterRemoval(localDefinition, next, selection)); setRemoving(null)
      }}>Confirm removal</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </div>
}
