'use client'

import { useId, useState } from 'react'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import type { IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { NewItem } from '@/lib/intake/forms/editorState'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'
import { INTAKE_QUESTION_TYPES } from '@/lib/intake/forms/schema'
import { QUESTION_TYPE_LABELS } from '@/lib/forms/clientFormAnswers'

const controlLabels = { text: 'Text', textarea: 'Long text', email: 'Email', tel: 'Phone', date: 'Date', select: 'Single choice', multiselect: 'Multiple choice', boolean: 'Yes/no' }
const requirementLabels = { optional: 'Optional', recommended: 'Recommended', required: 'Required' }

export function IntakeCatalogDrawer({ definition, catalog, sectionId, onClose, onAdd, onRestoreFocus }: {
  definition: IntakeFormDefinition; catalog: IntakeFormBuilderCatalog; sectionId: string | null
  onClose: () => void; onAdd: (item: NewItem) => void; onRestoreFocus: () => void
}) {
  const [query, setQuery] = useState('')
  const metadataId = useId()
  const section = definition.sections.find(value => value.id === sectionId)
  if (definition.purpose === 'client_form') {
    const full = Boolean(section && section.items.length >= 100)
    return <Sheet open={Boolean(section)} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent className="w-full sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus() }}>
        <SheetHeader><SheetTitle>Add a question</SheetTitle><SheetDescription>Choose the kind of answer for a new question in {section?.title}. Answers stay with the sent form; they are not copied into the client record.</SheetDescription></SheetHeader>
        {full && <p className="px-4 text-sm">Section has reached its 100-item limit</p>}
        <ul className="space-y-1 overflow-auto px-4 pb-4">
          {INTAKE_QUESTION_TYPES.map(type => <li key={type}><button type="button" disabled={full} className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
            onClick={() => onAdd({ kind: 'question', questionType: type, label: 'New question', ...(type === 'single_choice' || type === 'multiple_choice' ? { options: ['Option 1', 'Option 2'] } : {}) })}>
            {QUESTION_TYPE_LABELS[type]}
          </button></li>)}
        </ul>
      </SheetContent>
    </Sheet>
  }
  const used = new Set(definition.sections.flatMap(value => value.items.flatMap(item => item.kind === 'field' ? [item.fieldId] : [])))
  const entries = [
    ...catalog.fields.map(field => ({ ...field, kind: 'field' as const, reason: used.has(field.id) ? 'Already used in this form' : '' })),
    ...catalog.blocks.map(block => ({ ...block, kind: 'block' as const, reason: section && !block.audiences.includes(section.audience) ? 'Requires a staff-only section' : '' })),
  ].map(entry => ({ ...entry, reason: entry.reason || (section && section.items.length >= 100 ? 'Section has reached its 100-item limit' : '') }))
  const matches = entries.filter(entry => `${entry.label} ${entry.description} ${entry.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = [...new Set(matches.map(entry => entry.group))]
  return <Sheet open={Boolean(section)} onOpenChange={open => { if (!open) { setQuery(''); onClose() } }}>
    <SheetContent className="w-full sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus() }}>
      <SheetHeader><SheetTitle>Add approved item</SheetTitle><SheetDescription>Choose a field or block for {section?.title}.</SheetDescription></SheetHeader>
      <Command shouldFilter={false} label="Search approved catalog">
        <CommandInput aria-label="Search approved catalog" placeholder="Search fields and blocks…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-none flex-1 overflow-auto">
          <CommandEmpty>No matching approved items.</CommandEmpty>
          {groups.map(group => <CommandGroup key={group} heading={group}>{matches.filter(entry => entry.group === group).map(entry => <CommandItem
            key={`${entry.kind}:${entry.id}`} value={`${entry.kind}:${entry.id}`} disabled={Boolean(entry.reason)} aria-label={`${entry.label} ${entry.description} ${entry.id}${entry.reason ? ` ${entry.reason}` : ''}`}
            aria-describedby={`${metadataId}-${entry.kind}-${entry.id}`}
            onSelect={() => { if (!entry.reason) { onAdd(entry.kind === 'field' ? { kind: 'field', fieldId: entry.id } : { kind: 'block', blockId: entry.id }); setQuery('') } }}
            className="flex-col items-start gap-1"
          >
            <span>{entry.label}</span><span className="text-xs text-muted-foreground">{entry.description}</span>
            <span id={`${metadataId}-${entry.kind}-${entry.id}`} className="text-xs text-muted-foreground">
              Type: {entry.kind === 'field' ? controlLabels[entry.control] : 'Compound block'}
              {entry.kind === 'field' && <> · Baseline: {requirementLabels[entry.baselineRequirement]}</>}
              {' · '}Audience: {entry.audiences.map(audience => audience === 'staff_only' ? 'Staff only' : 'Client and staff').join('; ')}
            </span>
            <span className="text-xs text-muted-foreground">{entry.id}</span>
            {entry.reason && <span className="text-xs">{entry.reason}</span>}
          </CommandItem>)}</CommandGroup>)}
        </CommandList>
      </Command>
    </SheetContent>
  </Sheet>
}
