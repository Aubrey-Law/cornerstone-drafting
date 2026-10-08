'use client'

import type { IntakeFormDiagnostic } from '@/lib/intake/forms/compiler'
import type { IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import { targetForDiagnostic } from '@/lib/intake/forms/editorState'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

export function IntakeFormDiagnostics({ diagnostics, definition, catalog, onNavigate }: {
  diagnostics: IntakeFormDiagnostic[]
  definition: IntakeFormDefinition
  catalog: IntakeFormBuilderCatalog
  onNavigate: (diagnostic: IntakeFormDiagnostic) => void
}) {
  const groups = new Map<string, { label: string; diagnostics: IntakeFormDiagnostic[] }>()
  for (const diagnostic of diagnostics) {
    const target = targetForDiagnostic(diagnostic.path, definition)
    const section = target.kind === 'form' ? undefined : definition.sections.find(value => value.id === target.sectionId)
    const item = target.kind === 'item' ? section?.items.find(value => value.id === target.itemId) : undefined
    const itemLabel = item?.kind === 'field'
      ? item.labelOverride || catalog.fields.find(value => value.id === item.fieldId)?.label || item.fieldId
      : item?.kind === 'block' ? item.titleOverride || catalog.blocks.find(value => value.id === item.blockId)?.label || item.blockId : ''
    const label = item && section ? `Item: ${itemLabel} (${item.id}) · Section: ${section.title || 'Untitled'} (${section.id})`
      : section ? `Section: ${section.title || 'Untitled'} (${section.id})` : `Form: ${definition.title || 'Untitled'} (${definition.key})`
    const key = JSON.stringify([target.kind, section?.id, item?.id])
    const group = groups.get(key)
    if (group) group.diagnostics.push(diagnostic)
    else groups.set(key, { label, diagnostics: [diagnostic] })
  }
  return <section aria-labelledby="intake-diagnostics-heading" className="rounded-lg border bg-muted p-4">
    <h2 id="intake-diagnostics-heading" className="font-medium">Form checks</h2>
    <p className="text-sm text-muted-foreground" role="status">{diagnostics.length ? `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'} to resolve before publishing` : 'No form issues found'}</p>
    {[...groups].map(([key, group]) => <div key={key} className="mt-3 space-y-2">
      <h3 className="text-sm font-medium">{group.label}</h3>
      <ul className="space-y-2">{group.diagnostics.map(diagnostic => <li key={JSON.stringify([diagnostic.path, diagnostic.message])}>
        <button type="button" aria-label={`${group.label}: ${diagnostic.message}`} onClick={() => onNavigate(diagnostic)} className="text-left text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">{diagnostic.message}</button>
      </li>)}</ul>
    </div>)}
  </section>
}
