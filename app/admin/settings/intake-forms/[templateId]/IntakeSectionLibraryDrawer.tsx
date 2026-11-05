'use client'

import { useId, useState } from 'react'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import type { BuilderCatalogSection, IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

function itemName(item: BuilderCatalogSection['items'][number], catalog: IntakeFormBuilderCatalog): string {
  if (item.kind === 'field') return item.labelOverride ?? catalog.fields.find(field => field.id === item.fieldId)?.label ?? item.fieldId
  return item.titleOverride ?? catalog.blocks.find(block => block.id === item.blockId)?.label ?? item.blockId
}

function conflictReason(definition: IntakeFormDefinition, section: BuilderCatalogSection, catalog: IntakeFormBuilderCatalog): string {
  const usedFields = new Set(definition.sections.flatMap(existing => existing.items.flatMap(item => item.kind === 'field' ? [item.fieldId] : [])))
  const usedBlocks = new Set(definition.sections.flatMap(existing => existing.items.flatMap(item => item.kind === 'block' ? [item.blockId] : [])))
  const names = section.items.flatMap(item => {
    if (item.kind === 'field' && usedFields.has(item.fieldId)) return [itemName(item, catalog)]
    if (item.kind === 'block' && usedBlocks.has(item.blockId)) return [itemName(item, catalog)]
    return []
  })
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is already in this form`
  return `${names.length} questions are already in this form`
}

function summary(section: BuilderCatalogSection): string {
  const count = section.items.length
  const questions = `${count} ${count === 1 ? 'question' : 'questions'}`
  const minutes = section.timeEstimateMinutes == null ? '' : ` · about ${section.timeEstimateMinutes} ${section.timeEstimateMinutes === 1 ? 'minute' : 'minutes'}`
  return `${section.optional ? 'Optional · ' : ''}${questions}${minutes}`
}

export function IntakeSectionLibraryDrawer({ definition, catalog, open, onClose, onAdd, onRestoreFocus }: {
  definition: IntakeFormDefinition
  catalog: IntakeFormBuilderCatalog
  open: boolean
  onClose: () => void
  onAdd: (sectionId: string) => void
  onRestoreFocus: () => void
}) {
  const [query, setQuery] = useState('')
  const metadataId = useId()
  const entries = catalog.sections.map(section => ({ ...section, reason: conflictReason(definition, section, catalog) }))
  const needle = query.trim().toLowerCase()
  const matches = entries.filter(section => {
    const questions = section.items.map(item => `${itemName(item, catalog)} ${item.kind === 'field' ? item.fieldId : item.blockId}`).join(' ')
    return `${section.label} ${section.description} ${section.id} ${questions}`.toLowerCase().includes(needle)
  })
  const groups = [...new Set(matches.map(section => section.group))]
  return <Sheet open={open} onOpenChange={next => { if (!next) { setQuery(''); onClose() } }}>
    <SheetContent className="w-full sm:max-w-lg" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus() }}>
      <SheetHeader>
        <SheetTitle>College Preparation sections</SheetTitle>
        <SheetDescription>Each section brings its questions and follow-up rules.</SheetDescription>
      </SheetHeader>
      <Command shouldFilter={false} label="Search section library">
        <CommandInput aria-label="Search section library" placeholder="Search sections…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-none flex-1 overflow-auto">
          <CommandEmpty>No matching sections. Try a question, such as FERPA or living will.</CommandEmpty>
          {groups.map(group => <CommandGroup key={group} heading={group}>{matches.filter(section => section.group === group).map(section => <CommandItem
            key={section.id} value={section.id} disabled={Boolean(section.reason)}
            aria-label={`${section.label} ${section.description} ${summary(section)}${section.reason ? ` ${section.reason}` : ''}`}
            aria-describedby={`${metadataId}-${section.id}`}
            onSelect={() => { if (!section.reason) { onAdd(section.id); setQuery('') } }}
            className="flex-col items-start gap-1"
          >
            <span>{section.label}</span>
            <span className="text-xs text-muted-foreground">{section.description}</span>
            <span id={`${metadataId}-${section.id}`} className="text-xs text-muted-foreground">{summary(section)}</span>
            {section.reason && <span className="text-xs">{section.reason}</span>}
          </CommandItem>)}</CommandGroup>)}
        </CommandList>
      </Command>
    </SheetContent>
  </Sheet>
}
