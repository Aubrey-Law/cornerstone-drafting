'use client'

import { useEffect, useRef, useState } from 'react'
import { MatterAssistantQuickPrompts } from '@/app/admin/components/MatterAssistantQuickPrompts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { LeadReadinessDial } from '@/components/leads/LeadReadinessDial'
import type { LeadEditableField } from '@/lib/leads/details'
import {
  isNameField,
  labelForLeadField,
  LEAD_FIELD_GROUPS,
  leadFieldDefinition,
  NAME_COMPONENTS,
  normalizedLeadFieldValue,
  valueForLeadField,
  hasText,
  type LeadAddressDraft,
  type LeadFieldDefinition,
  type LeadSpouseDraft,
} from '@/lib/leads/fieldDefinitions'
import { cn } from '@/lib/utils'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

export type LeadRecord = LeadDetailRecord
export type LeadSpouse = LeadSpouseRecord

type FieldErrorState = {
  field: LeadEditableField
  message: string
}

export type LeadFieldsRailProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  activeField: LeadEditableField | null
  onActiveFieldChange: (field: LeadEditableField | null) => void
  onSaveField: (field: LeadEditableField, value: unknown) => Promise<void>
  onRemoveSpouse: () => void
  spouseRemovalError?: string | null
  className?: string
  /** Hidden inside the index side panel, where the rail is already narrow. */
  showAssistantPrompts?: boolean
}

const ASSISTANT_PROMPTS = [
  { label: 'Summarize intake', prompt: "Summarize this client's situation" },
  { label: 'Analyze MA estate tax', prompt: 'Analyze MA estate tax exposure' },
  { label: 'Draft a pre-call email', prompt: 'Draft a pre-call email for this lead' },
]

function initials(...parts: (string | null | undefined)[]) {
  const letters = parts
    .filter(hasText)
    .map(part => part.trim()[0]?.toUpperCase())
    .filter(Boolean)
  return letters.slice(0, 2).join('') || '—'
}

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</span>
}

export function LeadFieldsRail({
  lead,
  spouse,
  activeField,
  onActiveFieldChange,
  onSaveField,
  onRemoveSpouse,
  spouseRemovalError = null,
  className,
  showAssistantPrompts = true,
}: LeadFieldsRailProps) {
  const [draft, setDraft] = useState<unknown>(null)
  const [savingField, setSavingField] = useState<LeadEditableField | null>(null)
  const [savedField, setSavedField] = useState<LeadEditableField | null>(null)
  const [fieldError, setFieldError] = useState<FieldErrorState | null>(null)
  const lastPersistedRef = useRef<unknown>(null)
  const savingRef = useRef(false)
  const suppressSpouseBlurRef = useRef(false)
  const removeSpouseButtonRef = useRef<HTMLButtonElement | null>(null)
  const triggerRefs = useRef<Partial<Record<LeadEditableField, HTMLButtonElement | null>>>({})

  useEffect(() => {
    if (!activeField) return
    const persisted = valueForLeadField(activeField, lead, spouse)
    lastPersistedRef.current = persisted
    setDraft(persisted)
  }, [activeField, lead, spouse])

  useEffect(() => {
    if (!spouseRemovalError) return
    requestAnimationFrame(() => removeSpouseButtonRef.current?.focus())
  }, [spouseRemovalError])

  const statusField = savingField ?? savedField
  const statusLabel = labelForLeadField(statusField)
  const displayedFieldError = spouseRemovalError
    ? { field: 'spouse' as const, message: spouseRemovalError }
    : fieldError

  function restoreTrigger(field: LeadEditableField) {
    requestAnimationFrame(() => triggerRefs.current[field]?.focus())
  }

  function openField(field: LeadEditableField) {
    setSavedField(null)
    setFieldError(null)
    onActiveFieldChange(field)
  }

  function definitionIsActive(field: LeadFieldDefinition) {
    return field.key === 'firstName' ? isNameField(activeField) : activeField === field.key
  }

  function cancelField(field: LeadEditableField) {
    setDraft(lastPersistedRef.current)
    onActiveFieldChange(null)
    restoreTrigger(field)
  }

  async function commitField(field: LeadEditableField, nextDraft = draft) {
    if (savingRef.current) return
    const value = normalizedLeadFieldValue(field, nextDraft)
    const persisted = normalizedLeadFieldValue(field, lastPersistedRef.current)
    if (equalValue(value, persisted)) {
      onActiveFieldChange(null)
      restoreTrigger(field)
      return
    }

    savingRef.current = true
    setSavingField(field)
    setSavedField(null)
    setFieldError(null)
    try {
      await onSaveField(field, value)
      setSavingField(null)
      setSavedField(field)
      onActiveFieldChange(null)
      restoreTrigger(field)
    } catch (error) {
      setDraft(lastPersistedRef.current)
      setSavingField(null)
      setSavedField(null)
      setFieldError({
        field,
        message: error instanceof Error ? error.message : 'Could not save field',
      })
      onActiveFieldChange(null)
      restoreTrigger(field)
    } finally {
      savingRef.current = false
    }
  }

  function handleEditorBlur(field: LeadEditableField, event: React.FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    if (field === 'spouse' && suppressSpouseBlurRef.current) {
      suppressSpouseBlurRef.current = false
      return
    }
    void commitField(field)
  }

  function handleEditorKeyDown(field: LeadEditableField, event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelField(field)
      return
    }
    if (
      event.key === 'Enter'
      && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
    ) {
      event.preventDefault()
      void commitField(field)
    }
  }

  function renderEditor(field: LeadFieldDefinition) {
    const sharedContainerProps = {
      onBlur: (event: React.FocusEvent<HTMLDivElement>) => handleEditorBlur(field.key, event),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => handleEditorKeyDown(field.key, event),
    }
    const disabled = savingField === field.key

    if (field.input === 'address') {
      const address = draft as LeadAddressDraft | null
      if (!address) return null
      const update = (key: keyof LeadAddressDraft, value: string) =>
        setDraft((current: unknown) => ({ ...(current as LeadAddressDraft), [key]: value }))
      return (
        <div {...sharedContainerProps} className="grid gap-2">
          <label className="space-y-1"><FieldLabel>Address line 1</FieldLabel><Input autoFocus aria-label="Address line 1" disabled={disabled} value={address.addressLine1} onChange={event => update('addressLine1', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Address line 2</FieldLabel><Input aria-label="Address line 2" disabled={disabled} value={address.addressLine2} onChange={event => update('addressLine2', event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><FieldLabel>City</FieldLabel><Input aria-label="City" disabled={disabled} value={address.city} onChange={event => update('city', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>State</FieldLabel><Input aria-label="State" disabled={disabled} value={address.state} onChange={event => update('state', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>ZIP</FieldLabel><Input aria-label="ZIP" disabled={disabled} value={address.zip} onChange={event => update('zip', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>County</FieldLabel><Input aria-label="County" disabled={disabled} value={address.county} onChange={event => update('county', event.target.value)} /></label>
          </div>
        </div>
      )
    }

    if (field.input === 'spouse') {
      const spouseDraft = draft as LeadSpouseDraft | null
      if (!spouseDraft) return null
      const update = (key: keyof LeadSpouseDraft, value: string) =>
        setDraft((current: unknown) => ({ ...(current as LeadSpouseDraft), [key]: value }))
      return (
        <div {...sharedContainerProps} className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><FieldLabel>Spouse first name</FieldLabel><Input autoFocus aria-label="Spouse first name" disabled={disabled} value={spouseDraft.firstName} onChange={event => update('firstName', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>Spouse middle name</FieldLabel><Input aria-label="Spouse middle name" disabled={disabled} value={spouseDraft.middleName} onChange={event => update('middleName', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>Spouse last name</FieldLabel><Input aria-label="Spouse last name" disabled={disabled} value={spouseDraft.lastName} onChange={event => update('lastName', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>Spouse preferred name</FieldLabel><Input aria-label="Spouse preferred name" disabled={disabled} value={spouseDraft.preferredName} onChange={event => update('preferredName', event.target.value)} /></label>
          </div>
          <label className="space-y-1"><FieldLabel>Spouse email</FieldLabel><Input aria-label="Spouse email" disabled={disabled} type="email" value={spouseDraft.email} onChange={event => update('email', event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><FieldLabel>Spouse phone</FieldLabel><Input aria-label="Spouse phone" disabled={disabled} value={spouseDraft.phone} onChange={event => update('phone', event.target.value)} /></label>
            <label className="space-y-1"><FieldLabel>Spouse date of birth</FieldLabel><Input aria-label="Spouse date of birth" disabled={disabled} type="date" value={spouseDraft.dateOfBirth} onChange={event => update('dateOfBirth', event.target.value)} /></label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {spouse ? (
              <Button
                aria-describedby={spouseRemovalError ? 'lead-spouse-error' : undefined}
                aria-invalid={spouseRemovalError ? true : undefined}
                ref={removeSpouseButtonRef}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  suppressSpouseBlurRef.current = true
                  onRemoveSpouse()
                }}
              >
                Remove spouse
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => cancelField('spouse')}>Cancel spouse</Button>
            )}
            <Button type="button" size="sm" disabled={disabled} onClick={() => void commitField('spouse')}>Save spouse</Button>
          </div>
        </div>
      )
    }

    if (field.input === 'select') {
      return (
        <div {...sharedContainerProps}>
          <select
            autoFocus
            aria-label={field.label}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]"
            disabled={disabled}
            value={String(draft ?? '')}
            onChange={event => {
              const next = event.target.value
              setDraft(next)
              void commitField(field.key, next)
            }}
          >
            <option value="">Not set</option>
            {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      )
    }

    if (field.input === 'textarea') {
      return (
        <div {...sharedContainerProps}>
          <Textarea autoFocus aria-label={field.label} disabled={disabled} value={String(draft ?? '')} onChange={event => setDraft(event.target.value)} />
        </div>
      )
    }

    return (
      <div {...sharedContainerProps}>
        <Input
          autoFocus
          aria-label={field.label}
          className="h-8"
          disabled={disabled}
          min={field.input === 'number' ? 0 : undefined}
          type={field.input}
          value={String(draft ?? '')}
          onChange={event => setDraft(event.target.value)}
        />
      </div>
    )
  }

  /** The name row splits into one trigger per populated component. */
  function renderNameValue() {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {NAME_COMPONENTS.map(component => {
          const value = lead[component.property]
          const populated = hasText(value)
          return (
            <button
              aria-label={`${populated ? 'Edit' : 'Add'} ${component.label}`}
              aria-describedby={displayedFieldError?.field === component.key ? `lead-${component.key}-error` : undefined}
              aria-invalid={displayedFieldError?.field === component.key || undefined}
              className={populated
                ? 'rounded-sm text-left text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring'
                : 'rounded-full border border-dashed border-border px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring'}
              disabled={activeField !== null}
              key={component.key}
              ref={element => { triggerRefs.current[component.key] = element }}
              type="button"
              onClick={() => openField(component.key)}
            >
              {populated ? value : `+ Add ${component.label}`}
            </button>
          )
        })}
      </div>
    )
  }

  function renderSpouseValue(display: string) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-muted text-[9px] font-semibold text-muted-foreground"
        >
          {initials(spouse?.first_name, spouse?.last_name)}
        </span>
        <span className="text-sm font-medium">{display}</span>
      </span>
    )
  }

  function renderRow(field: LeadFieldDefinition) {
    const active = definitionIsActive(field)
    const display = field.display(lead, spouse)
    const isName = field.key === 'firstName'
    // A name row edits one component at a time, so the editor borrows that
    // component's label rather than the row's "Name".
    const activeNameComponent = isName && isNameField(activeField)
      ? NAME_COMPONENTS.find(component => component.key === activeField)
      : undefined
    const editedField: LeadFieldDefinition = activeNameComponent
      ? {
          key: activeNameComponent.key,
          label: activeNameComponent.label,
          missingLabel: activeNameComponent.label,
          complete: () => true,
          display: () => null,
          input: 'text',
        }
      : field

    return (
      <div
        className={cn(
          'flex min-h-[30px] items-start gap-2 border-b border-muted py-1.5 last:border-b-0',
          // Editors (address, spouse) need the full row even in the two-column
          // layout the rail uses once it is wide enough.
          active && '@2xl/rail:col-span-2',
        )}
        key={field.key}
      >
        <span className="w-[118px] shrink-0 pt-1 text-xs text-muted-foreground">{field.label}</span>
        <div className="min-w-0 flex-1">
          {active ? (
            <>
              {renderEditor(editedField)}
              <p className="mt-1 text-[10px] text-muted-foreground">Enter to save · Esc to cancel</p>
            </>
          ) : isName ? (
            renderNameValue()
          ) : display == null ? (
            <button
              aria-label={`Add ${field.label}`}
              aria-describedby={displayedFieldError?.field === field.key ? `lead-${field.key}-error` : undefined}
              aria-invalid={displayedFieldError?.field === field.key || undefined}
              className="h-6 rounded-full border border-dashed border-border px-2 text-xs font-medium text-muted-foreground outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              disabled={activeField !== null}
              ref={element => { triggerRefs.current[isName ? 'firstName' : field.key] = element }}
              type="button"
              onClick={() => openField(isName ? 'firstName' : field.key)}
            >
              + Add
            </button>
          ) : (
            <button
              aria-label={`Edit ${field.label}`}
              aria-describedby={displayedFieldError?.field === field.key ? `lead-${field.key}-error` : undefined}
              aria-invalid={displayedFieldError?.field === field.key || undefined}
              className="w-full rounded-sm text-left text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              disabled={activeField !== null}
              ref={element => { triggerRefs.current[field.key] = element }}
              type="button"
              onClick={() => openField(field.key)}
            >
              {field.key === 'spouse'
                ? renderSpouseValue(display)
                : <span className={field.key === 'qualificationNotes' ? 'whitespace-pre-wrap font-normal' : ''}>{display}</span>}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <aside
      aria-label="Lead details"
      className={cn(
        '@container/rail flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-4',
        className,
      )}
      onPointerDownCapture={event => {
        if (event.target instanceof HTMLButtonElement && event.target.disabled) {
          event.preventDefault()
        }
      }}
    >
      <LeadReadinessDial lead={lead} spouse={spouse} />

      <div className="mt-4 space-y-4">
        {LEAD_FIELD_GROUPS.map(group => (
          <section key={group.title}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h3>
            <div className="mt-1 @2xl/rail:grid @2xl/rail:grid-cols-2 @2xl/rail:gap-x-6">
              {group.keys
                .map(key => leadFieldDefinition(key))
                .filter((definition): definition is LeadFieldDefinition => Boolean(definition))
                .map(renderRow)}
            </div>
          </section>
        ))}
      </div>

      {statusLabel && (
        <span aria-label={`${statusLabel} save status`} aria-live="polite" className="mt-2 block text-[11px] text-muted-foreground" role="status">
          {savingField ? 'Saving' : 'Saved'}
        </span>
      )}

      {displayedFieldError && (
        <p className="mt-2 text-xs text-destructive" id={`lead-${displayedFieldError.field}-error`} role="alert">
          {displayedFieldError.message}
        </p>
      )}

      <footer className="mt-auto pt-4">
        <p className="text-[11px] text-muted-foreground">
          Intake answers land here automatically — you rarely need to type these.
        </p>
        {showAssistantPrompts && (
          <MatterAssistantQuickPrompts className="mt-2 flex flex-wrap gap-2" prompts={ASSISTANT_PROMPTS} />
        )}
      </footer>
    </aside>
  )
}
