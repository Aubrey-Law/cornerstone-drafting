'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { BuilderCatalogField, IntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import { eligibleConditionFields, type EditorSelection, type ItemPatch, type NewSection } from '@/lib/intake/forms/editorState'
import type { IntakeCondition, IntakeFormDefinition, IntakeRequirement } from '@/lib/intake/forms/types'

const selectClass = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring'
const requirements: IntakeRequirement[] = ['optional', 'recommended', 'required']

function Control({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-1"><label className="text-sm font-medium" htmlFor={id}>{label}</label>{children}</div>
}
function TextControl({ id, label, value, onChange, long = false, readOnly = false }: {
  id: string; label: string; value: string; onChange?: (value: string) => void; long?: boolean; readOnly?: boolean
}) {
  const props = { id, value, readOnly, maxLength: long ? 600 : 160, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange?.(event.target.value) }
  return <Control id={id} label={label}>{long ? <Textarea {...props} /> : <Input {...props} />}</Control>
}

function defaultLeaf(field: BuilderCatalogField): Extract<IntakeCondition, { op: 'equals' }> {
  return { op: 'equals', fieldId: field.id, value: field.control === 'boolean' ? true : field.options?.[0]?.value ?? '' }
}

function ConditionNode({ condition, fields, id, onChange, depth = 1 }: {
  condition: IntakeCondition; fields: BuilderCatalogField[]; id: string; onChange: (value: IntakeCondition) => void; depth?: number
}) {
  const compound = 'conditions' in condition
  const field = !compound ? fields.find(value => value.id === condition.fieldId) : undefined
  function changeOperator(op: IntakeCondition['op']) {
    if (op === 'all' || op === 'any') {
      if (depth >= 5) return
      onChange({ op, conditions: compound ? condition.conditions : [condition] })
    } else {
      const leaf = compound ? fields[0] && defaultLeaf(fields[0]) : condition
      if (!leaf || 'conditions' in leaf) return
      onChange(op === 'is_set' ? { op, fieldId: leaf.fieldId } : { op, fieldId: leaf.fieldId, value: 'value' in leaf ? leaf.value : field?.control === 'boolean' ? true : field?.options?.[0]?.value ?? '' })
    }
  }
  return <div className="space-y-3 rounded border p-3">
    <Control id={`${id}-operator`} label="Condition operator"><select id={`${id}-operator`} className={selectClass} value={condition.op} onChange={event => changeOperator(event.target.value as IntakeCondition['op'])}>
      <option value="equals" disabled={compound && !fields.length}>Equals</option><option value="not_equals" disabled={compound && !fields.length}>Not equals</option><option value="is_set" disabled={compound && !fields.length}>Is set</option>
      <option value="all" disabled={depth >= 5}>All</option><option value="any" disabled={depth >= 5}>Any</option>
    </select></Control>
    {compound ? <div className="space-y-3">
      {condition.conditions.map((child, index) => <div key={index}>
        <ConditionNode condition={child} fields={fields} id={`${id}-${index}`} depth={depth + 1} onChange={value => onChange({ ...condition, conditions: condition.conditions.map((existing, i) => i === index ? value : existing) })} />
        <Button variant="ghost" size="sm" disabled={condition.conditions.length <= 1} aria-label={`Remove condition ${index + 1}`} onClick={() => onChange({ ...condition, conditions: condition.conditions.filter((_, i) => i !== index) })}>Remove condition {index + 1}</Button>
      </div>)}
      <Button variant="outline" size="sm" disabled={depth >= 5 || !fields.length} onClick={() => onChange({ ...condition, conditions: [...condition.conditions, defaultLeaf(fields[0])] })}>Add condition</Button>
    </div> : <>
      <Control id={`${id}-field`} label="Condition field"><select id={`${id}-field`} className={selectClass} value={condition.fieldId} onChange={event => {
        const next = fields.find(value => value.id === event.target.value)
        if (!next) return
        const leaf = defaultLeaf(next)
        onChange(condition.op === 'is_set' ? { op: 'is_set', fieldId: next.id } : { ...leaf, op: condition.op })
      }}>
        {!field && <option value={condition.fieldId} disabled>{condition.fieldId} (no longer eligible)</option>}
        {fields.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}
      </select></Control>
      {condition.op !== 'is_set' && <Control id={`${id}-value`} label="Condition value">
        {field?.control === 'boolean' ? <select id={`${id}-value`} className={selectClass} value={typeof condition.value === 'boolean' ? String(condition.value) : `invalid:${condition.value}`} onChange={event => onChange({ ...condition, value: event.target.value === 'true' })}>
          {typeof condition.value !== 'boolean' && <option disabled value={`invalid:${condition.value}`}>{String(condition.value)} (invalid value)</option>}
          <option value="true">True</option><option value="false">False</option>
        </select> : field?.options ? <select id={`${id}-value`} className={selectClass} value={String(condition.value)} onChange={event => onChange({ ...condition, value: event.target.value })}>
          {!field.options.some(option => option.value === condition.value) && <option disabled value={String(condition.value)}>{String(condition.value)} (not an approved option)</option>}
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : <Input id={`${id}-value`} value={String(condition.value)} readOnly={!field} onChange={event => onChange({ ...condition, value: event.target.value })} />}
      </Control>}
      {!field && <p className="text-sm text-muted-foreground">This stored condition is preserved. Move its field earlier or select an eligible field.</p>}
    </>}
  </div>
}

export function IntakeFormInspector({ definition, catalog, selection, onFormChange, onSectionChange, onItemChange, onMoveItem, readOnly = false }: {
  definition: IntakeFormDefinition; catalog: IntakeFormBuilderCatalog; selection: EditorSelection
  onFormChange: (patch: Partial<Pick<IntakeFormDefinition, 'title' | 'description'>>) => void
  onSectionChange: (id: string, patch: Partial<NewSection>) => void
  onItemChange: (id: string, patch: ItemPatch) => void
  onMoveItem: (itemId: string, toSectionId: string, toIndex: number) => void
  readOnly?: boolean
}) {
  const prefix = `intake-builder-${selection.kind}`
  const section = selection.kind === 'form' ? undefined : definition.sections.find(value => value.id === selection.sectionId)
  const item = selection.kind === 'item' ? section?.items.find(value => value.id === selection.itemId) : undefined
  const field = item?.kind === 'field' ? catalog.fields.find(value => value.id === item.fieldId) : undefined
  const block = item?.kind === 'block' ? catalog.blocks.find(value => value.id === item.blockId) : undefined
  const fields = eligibleConditionFields(definition, selection, catalog.fields)
  const condition = item ? item.condition : section?.condition
  const setCondition = (value: IntakeCondition | undefined) => {
    if (item) onItemChange(item.id, { condition: value })
    else if (section) onSectionChange(section.id, { condition: value })
  }
  return <section aria-label="Selection inspector" className="my-3 min-w-0 rounded-lg border bg-muted p-4 md:my-0">
    <h2 id={`${prefix}-heading`} tabIndex={-1} className="mb-4 font-semibold">{selection.kind === 'form' ? 'Form settings' : item ? 'Item settings' : 'Section settings'}</h2>
    <fieldset disabled={readOnly} className="min-w-0 space-y-4">
      <legend className="sr-only">{selection.kind} presentation</legend>
      {selection.kind === 'form' ? <>
        <TextControl id={`${prefix}-key`} label="Stable key" value={definition.key} readOnly />
        <TextControl id={`${prefix}-title`} label="Form title" value={definition.title} onChange={title => onFormChange({ title })} />
        <TextControl id={`${prefix}-description`} label="Description" value={definition.description ?? ''} long onChange={description => onFormChange({ description })} />
      </> : section && !item ? <>
        <TextControl id={`${prefix}-id`} label="Section ID" value={section.id} readOnly />
        <TextControl id={`${prefix}-title`} label="Section title" value={section.title} onChange={title => onSectionChange(section.id, { title })} />
        <TextControl id={`${prefix}-subtitle`} label="Subtitle" value={section.subtitle ?? ''} long onChange={subtitle => onSectionChange(section.id, { subtitle })} />
        <Control id={`${prefix}-audience`} label="Audience"><select id={`${prefix}-audience`} className={selectClass} value={section.audience} onChange={event => onSectionChange(section.id, { audience: event.target.value as NewSection['audience'] })}><option value="client_and_staff">Client and staff</option><option value="staff_only">Staff only</option></select></Control>
        <Control id={`${prefix}-timeEstimateMinutes`} label="Time estimate (minutes)"><Input id={`${prefix}-timeEstimateMinutes`} type="number" min="0" step="any" value={section.timeEstimateMinutes ?? ''} onChange={event => onSectionChange(section.id, { timeEstimateMinutes: event.target.value === '' ? undefined : Number(event.target.value) })} /></Control>
        <label className="flex gap-2 text-sm"><input id={`${prefix}-optional`} type="checkbox" checked={section.optional ?? false} onChange={event => onSectionChange(section.id, { optional: event.target.checked })} />Optional section</label>
      </> : item ? <>
        <TextControl id={`${prefix}-id`} label="Item ID" value={item.id} readOnly />
        <TextControl id={`${prefix}-${item.kind === 'field' ? 'fieldId' : 'blockId'}`} label={item.kind === 'field' ? 'Canonical field' : 'Approved block'} value={item.kind === 'field' ? item.fieldId : item.blockId} readOnly />
        <TextControl id={`${prefix}-${item.kind === 'field' ? 'labelOverride' : 'titleOverride'}`} label={item.kind === 'field' ? 'Label' : 'Block title'} value={item.kind === 'field' ? item.labelOverride ?? field?.label ?? '' : item.titleOverride ?? block?.label ?? ''} onChange={value => onItemChange(item.id, item.kind === 'field' ? { labelOverride: value } : { titleOverride: value })} />
        <TextControl id={`${prefix}-helpText`} label="Help text" value={item.helpText ?? ''} long onChange={helpText => onItemChange(item.id, { helpText })} />
        {item.kind === 'field' && field && <Control id={`${prefix}-requirement`} label="Requirement">
          <select id={`${prefix}-requirement`} className={selectClass} value={item.requirement ?? field.baselineRequirement} onChange={event => onItemChange(item.id, { requirement: event.target.value as IntakeRequirement })}>
            {requirements.map((value, index) => <option key={value} value={value} disabled={index < requirements.indexOf(field.baselineRequirement)}>{value[0].toUpperCase() + value.slice(1)}{index < requirements.indexOf(field.baselineRequirement) ? ' (below field minimum)' : ''}</option>)}
          </select><p className="text-xs text-muted-foreground">Minimum requirement: {field.baselineRequirement}. The field’s approved validation remains in effect.</p>
        </Control>}
        {item.kind === 'block' && block?.configControls.map(control => <Control key={control.key} id={`${prefix}-config-${control.key}`} label={control.label}>
          {control.control === 'select' ? <select id={`${prefix}-config-${control.key}`} className={selectClass} value={String(item.config?.[control.key] ?? control.options[0]?.value ?? '')} onChange={event => onItemChange(item.id, { config: { ...item.config, [control.key]: event.target.value } })}>
            {item.config?.[control.key] !== undefined && !control.options.some(option => option.value === item.config?.[control.key]) && <option disabled value={String(item.config[control.key])}>{String(item.config[control.key])} (invalid value)</option>}
            {control.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : <input id={`${prefix}-config-${control.key}`} type="checkbox" checked={item.config?.[control.key] !== false} onChange={event => onItemChange(item.id, { config: { ...item.config, [control.key]: event.target.checked } })} />}
        </Control>)}
        <Control id={`${prefix}-section`} label="Move to section"><select id={`${prefix}-section`} className={selectClass} value={section?.id} onChange={event => { const target = definition.sections.find(value => value.id === event.target.value); if (target) onMoveItem(item.id, target.id, target.items.length) }}>
          {definition.sections.map(value => <option key={value.id} value={value.id} disabled={value.id !== section?.id && value.items.length >= 100}>{value.title}</option>)}
        </select></Control>
      </> : null}
      {selection.kind !== 'form' && <section id={`${prefix}-condition`} tabIndex={-1} aria-label="Visibility condition" className="space-y-3 focus-visible:outline-2 focus-visible:outline-ring">
        <h3 className="text-sm font-semibold">Show when</h3>
        {condition ? <><ConditionNode condition={condition} fields={fields} id={`${prefix}-condition`} onChange={setCondition} /><Button variant="outline" size="sm" onClick={() => setCondition(undefined)}>Remove visibility condition</Button></> : <>
          <p className="text-sm text-muted-foreground">Always visible{fields.length ? '.' : '. Add an eligible scalar field earlier in the form to use a condition.'}</p>
          <Button variant="outline" size="sm" disabled={!fields.length} onClick={() => setCondition(defaultLeaf(fields[0]))}>Add visibility condition</Button>
        </>}
      </section>}
    </fieldset>
  </section>
}
