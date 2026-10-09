'use client'

import { useRef, type ReactNode, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { IntakeFormDefinition, IntakeFormItem } from '@/lib/intake/forms/types'
import type { IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { EditorSelection } from '@/lib/intake/forms/editorState'

export function itemLabel(item: IntakeFormItem, catalog: IntakeFormBuilderCatalog): string {
  if (item.kind === 'question') return item.label
  return item.kind === 'field' ? item.labelOverride ?? catalog.fields.find(field => field.id === item.fieldId)?.label ?? item.fieldId
    : item.titleOverride ?? catalog.blocks.find(block => block.id === item.blockId)?.label ?? item.blockId
}

type DragState = { kind: 'section' | 'item'; id: string; sectionId?: string }
export function IntakeFormOutline({ definition, catalog, selection, onSelect, onAddSection, onAddItem, onRemove, onMoveSection, onMoveItem, inlineInspector, readOnly = false }: {
  definition: IntakeFormDefinition; catalog: IntakeFormBuilderCatalog; selection: EditorSelection
  onSelect: (selection: EditorSelection) => void; onAddSection: () => void; onAddItem: (sectionId: string) => void
  onRemove: (selection: Exclude<EditorSelection, { kind: 'form' }>) => void
  onMoveSection: (id: string, toIndex: number) => void
  onMoveItem: (itemId: string, toSectionId: string, toIndex: number) => void
  inlineInspector?: ReactNode; readOnly?: boolean
}) {
  const drag = useRef<DragState | null>(null)
  const lastTarget = useRef<string | null>(null)
  const labels = definition.sections.flatMap(section => [section.title, ...section.items.map(item => itemLabel(item, catalog))])
  const actionLabel = (label: string, kind: 'section' | 'item', id: string) => labels.filter(candidate => candidate === label).length > 1 ? `${label} (${kind} ${id})` : label
  function start(event: DragEvent, state: DragState) { drag.current = state; lastTarget.current = null; event.dataTransfer.setData('text/plain', state.id); event.dataTransfer.effectAllowed = 'move' }
  function over(event: DragEvent, sectionId: string, itemId?: string) {
    event.preventDefault(); event.stopPropagation()
    if (readOnly || !drag.current) return
    const target = `${sectionId}:${itemId ?? ''}`
    if (lastTarget.current === target) return
    lastTarget.current = target
    const destination = definition.sections.find(section => section.id === sectionId)!
    if (drag.current.kind === 'section') {
      if (!itemId && drag.current.id !== sectionId) onMoveSection(drag.current.id, definition.sections.indexOf(destination))
    } else if (drag.current.id !== itemId) {
      const sourceIndex = destination.items.findIndex(item => item.id === drag.current?.id)
      const targetIndex = itemId ? destination.items.findIndex(item => item.id === itemId) : destination.items.length
      onMoveItem(drag.current.id, sectionId, itemId && sourceIndex !== -1 && sourceIndex < targetIndex ? targetIndex + 1 : targetIndex)
    }
  }
  const end = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); drag.current = null; lastTarget.current = null }
  return <div className="min-w-0 space-y-3" aria-label="Form outline">
    <Button variant="outline" className="w-full justify-start" aria-label="Select form" aria-current={selection.kind === 'form' ? 'true' : undefined} aria-pressed={selection.kind === 'form'} onClick={() => onSelect({ kind: 'form' })}>{definition.title || 'Untitled form'}</Button>
    {selection.kind === 'form' && inlineInspector}
    <ol aria-label="Sections" className="space-y-3">
      {definition.sections.map((section, sectionIndex) => <li key={section.id} className="rounded-lg border bg-background p-3" onDragOver={event => over(event, section.id)} onDrop={end}>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="icon" variant="ghost" disabled={readOnly} draggable={!readOnly} aria-label={`Drag section ${actionLabel(section.title, 'section', section.id)}`} onDragStart={event => start(event, { kind: 'section', id: section.id })} onDragEnd={end}><GripVertical className="size-4" /></Button>
          <Button variant="ghost" className="min-w-0 flex-1 justify-start whitespace-normal text-left" aria-label={`Select section ${section.title}`} aria-current={selection.kind === 'section' && selection.sectionId === section.id ? 'true' : undefined} aria-pressed={selection.kind === 'section' && selection.sectionId === section.id} onClick={() => onSelect({ kind: 'section', sectionId: section.id })}>{section.title || 'Untitled section'}</Button>
          <Button size="icon" variant="ghost" disabled={readOnly || sectionIndex === 0} aria-label={`Move ${actionLabel(section.title, 'section', section.id)} up`} onClick={() => onMoveSection(section.id, sectionIndex - 1)}><ArrowUp className="size-4" /></Button>
          <Button size="icon" variant="ghost" disabled={readOnly || sectionIndex === definition.sections.length - 1} aria-label={`Move ${actionLabel(section.title, 'section', section.id)} down`} onClick={() => onMoveSection(section.id, sectionIndex + 1)}><ArrowDown className="size-4" /></Button>
          <Button size="icon" variant="ghost" disabled={readOnly} aria-label={`Remove ${section.title}`} onClick={() => onRemove({ kind: 'section', sectionId: section.id })}><Trash2 className="size-4" /></Button>
        </div>
        {selection.kind === 'section' && selection.sectionId === section.id && inlineInspector}
        <ol aria-label={`${section.title} items`} className="space-y-2 border-l pl-3">
          {section.items.map((item, index) => { const label = itemLabel(item, catalog); return <li key={item.id} onDragOver={event => over(event, section.id, item.id)} onDrop={end}>
            <div className="flex flex-wrap items-center gap-1">
              <Button size="icon" variant="ghost" draggable={!readOnly} disabled={readOnly} aria-label={`Drag ${actionLabel(label, 'item', item.id)}`} onDragStart={event => { event.stopPropagation(); start(event, { kind: 'item', id: item.id, sectionId: section.id }) }} onDragEnd={end}><GripVertical className="size-4" /></Button>
              <Button variant="ghost" className="min-w-0 flex-1 justify-start whitespace-normal text-left" aria-label={`Select item ${label}`} aria-current={selection.kind === 'item' && selection.itemId === item.id ? 'true' : undefined} aria-pressed={selection.kind === 'item' && selection.itemId === item.id} onClick={() => onSelect({ kind: 'item', sectionId: section.id, itemId: item.id })}>{label || 'Untitled item'}</Button>
              <Button size="icon" variant="ghost" disabled={readOnly || index === 0} aria-label={`Move ${actionLabel(label, 'item', item.id)} up`} onClick={() => onMoveItem(item.id, section.id, index - 1)}><ArrowUp className="size-4" /></Button>
              <Button size="icon" variant="ghost" disabled={readOnly || index === section.items.length - 1} aria-label={`Move ${actionLabel(label, 'item', item.id)} down`} onClick={() => onMoveItem(item.id, section.id, index + 2)}><ArrowDown className="size-4" /></Button>
              <Button size="icon" variant="ghost" disabled={readOnly} aria-label={`Remove ${label}`} onClick={() => onRemove({ kind: 'item', sectionId: section.id, itemId: item.id })}><Trash2 className="size-4" /></Button>
            </div>
            {selection.kind === 'item' && selection.itemId === item.id && inlineInspector}
          </li> })}
        </ol>
        <Button variant="outline" size="sm" className="mt-3" disabled={readOnly || section.items.length >= 100} onClick={() => onAddItem(section.id)}><Plus className="mr-1 size-4" />Add item to {section.title}</Button>
      </li>)}
    </ol>
    <Button variant="outline" disabled={readOnly || definition.sections.length >= 40} onClick={onAddSection}><Plus className="mr-1 size-4" />Add section</Button>
  </div>
}
