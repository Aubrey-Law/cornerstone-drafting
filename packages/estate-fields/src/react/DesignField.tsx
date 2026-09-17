'use client'

import { useState, type ReactNode } from 'react'
import {
  getSharedField,
  inputTypeForControl,
  sharedFieldOptions,
  type SharedFieldId,
} from '../core'
import type { DesignSheetKey, DesignSheetLike } from '../core/designSheetKeys'
import { useDesignFieldComponents, type DesignSectionProps } from './context'

type DesignFieldProps<TSheet = DesignSheetLike> = {
  fieldId: SharedFieldId
  sheet: TSheet
  onChange: DesignSectionProps['onChange']
  originalValue?: string
  valueOverride?: string
  context?: {
    clientName?: string | null
    spouseName?: string | null
  }
  className?: string
  placeholder?: string
  footer?: ReactNode
}

export function DesignField<TSheet = DesignSheetLike>({
  fieldId,
  sheet,
  onChange,
  originalValue,
  valueOverride,
  context,
  footer,
  placeholder,
}: DesignFieldProps<TSheet>) {
  const { PrefilledInput, PrefilledSelect } = useDesignFieldComponents()
  const def = getSharedField(fieldId)
  const designKey = def.designKey
  if (!designKey) {
    throw new Error(`DesignField: ${fieldId} has no designKey`)
  }

  const stored = (sheet as DesignSheetLike)[designKey]
  const rawValue =
    valueOverride ??
    (typeof stored === 'string' ? stored : stored == null ? '' : String(stored))
  const value = def.normalize ? (def.normalize(rawValue) ?? '') : rawValue

  const handleChange = (next: string) => {
    const normalized = def.normalize ? def.normalize(next) : next.trim() || null
    onChange(designKey as DesignSheetKey, normalized)
  }

  if (def.control === 'textarea') {
    return (
      <DesignTextareaField
        fieldId={fieldId}
        sheet={sheet}
        onChange={onChange}
        originalValue={originalValue}
        valueOverride={valueOverride}
        footer={footer}
        placeholder={placeholder}
      />
    )
  }

  if (def.control === 'select') {
    const options = sharedFieldOptions(fieldId, context ?? {})
    return (
      <div>
        <PrefilledSelect
          fieldName={designKey}
          label={def.label}
          value={value}
          originalValue={originalValue}
          options={[...options]}
          onChange={handleChange}
        />
        {footer}
      </div>
    )
  }

  return (
    <div>
      <PrefilledInput
        fieldName={designKey}
        label={def.label}
        value={value}
        originalValue={originalValue}
        type={inputTypeForControl(def.control)}
        onChange={handleChange}
      />
      {footer}
    </div>
  )
}

type DesignChildFieldProps = {
  fieldId: 'child_name' | 'child_dob' | 'child_relationship' | 'child_parentage'
  value: string
  onChange: (value: string) => void
  context?: {
    clientName?: string | null
    spouseName?: string | null
  }
  footer?: ReactNode
}

export function DesignChildField({
  fieldId,
  value,
  onChange,
  context,
  footer,
}: DesignChildFieldProps) {
  const { PrefilledInput, PrefilledSelect } = useDesignFieldComponents()
  const def = getSharedField(fieldId)
  const normalized = def.normalize ? (def.normalize(value) ?? '') : value

  if (def.control === 'select') {
    const options = sharedFieldOptions(fieldId, context ?? {})
    return (
      <div>
        <PrefilledSelect
          label={def.label}
          value={normalized}
          options={[...options]}
          onChange={onChange}
        />
        {footer}
      </div>
    )
  }

  return (
    <div>
      <PrefilledInput
        label={def.label}
        value={normalized}
        type={inputTypeForControl(def.control)}
        onChange={onChange}
      />
      {footer}
    </div>
  )
}

type DesignTextareaFieldProps<TSheet = DesignSheetLike> = {
  fieldId: SharedFieldId
  sheet: TSheet
  onChange: DesignSectionProps['onChange']
  originalValue?: string
  valueOverride?: string
  footer?: ReactNode
  placeholder?: string
}

export function DesignTextareaField<TSheet = DesignSheetLike>({
  fieldId,
  sheet,
  onChange,
  originalValue,
  valueOverride,
  footer,
  placeholder,
}: DesignTextareaFieldProps<TSheet>) {
  const { FieldLabel, Textarea, cn, designFieldTargetId } = useDesignFieldComponents()
  const def = getSharedField(fieldId)
  if (!def.designKey) throw new Error(`DesignTextareaField: ${fieldId} has no designKey`)
  const column = def.designKey

  const stored = (sheet as DesignSheetLike)[column]
  const initial =
    valueOverride ??
    (typeof stored === 'string' ? stored : stored == null ? '' : String(stored))
  const [draft, setDraft] = useState(initial)
  const maxLength = def.maxLength ?? 2000
  const isOverride = originalValue !== undefined

  function commit() {
    const normalized = def.normalize ? def.normalize(draft) : draft.trim() || null
    onChange(column as DesignSheetKey, normalized)
  }

  return (
    <div>
      <FieldLabel>{def.label}</FieldLabel>
      <Textarea
        id={designFieldTargetId(String(column))}
        data-design-field={String(column)}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
        onBlur={commit}
        placeholder={placeholder ?? def.placeholder}
        className={cn(
          'min-h-[120px] resize-y text-sm leading-relaxed',
          isOverride ? 'bg-warning/10 border-warning/40' : 'bg-muted border-border',
        )}
        maxLength={maxLength}
      />
      {isOverride && (
        <p className="mt-1 text-micro font-medium text-warning">
          Prefilled: {originalValue?.trim() ? originalValue : 'Blank'}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-micro text-muted-foreground">Saved automatically on blur.</p>
        <p className="text-micro text-muted-foreground tabular-nums">
          {draft.length} / {maxLength}
        </p>
      </div>
      {footer}
    </div>
  )
}
