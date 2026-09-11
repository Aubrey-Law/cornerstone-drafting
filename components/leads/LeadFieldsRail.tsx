'use client'

import { useEffect, useRef, useState } from 'react'
import { MatterAssistantQuickPrompts } from '@/app/admin/components/MatterAssistantQuickPrompts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isSettledDateEntry } from '@/lib/firmDate'
import { formatPhoneInput } from '@/lib/phone'
import { Textarea } from '@/components/ui/textarea'
import { LeadReadinessDial } from '@/components/leads/LeadReadinessDial'
import { LeadEstateTaxCard } from '@/components/leads/LeadEstateTaxCard'
import type { LeadEditableField } from '@/lib/leads/details'
import {
  isNameField,
  labelForLeadField,
  LEAD_FIELD_GROUPS,
  leadFieldApplies,
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
import {
  MUTABLE_LEAD_STATUS_LABEL,
  type LeadDetailRecord,
  type LeadSpouseRecord,
  type MutableLeadStatus,
} from '@/lib/leads/viewTypes'

export type LeadRecord = LeadDetailRecord
export type LeadSpouse = LeadSpouseRecord

type FieldErrorState = {
  field: LeadEditableField
  message: string
}

export const LEAD_DETAIL_RAIL_WIDTH = 'w-[340px]'

export type LeadFieldsRailProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  /** Absent on surfaces that do not move the opportunity through the pipeline. */
  onStageChange?: (status: MutableLeadStatus) => void
  stageBusy?: boolean
  activeField: LeadEditableField | null
  onActiveFieldChange: (field: LeadEditableField | null) => void
  onSaveField: (field: LeadEditableField, value: unknown) => Promise<void>
  onRemoveSpouse: () => void
  spouseRemovalError?: string | null
  className?: string
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
  onStageChange,
  stageBusy = false,
  activeField,
  onActiveFieldChange,
  onSaveField,
  onRemoveSpouse,
  spouseRemovalError = null,
  className,
}: LeadFieldsRailProps) {
  // 'hired' is not in the mutable set — hiring runs through the convert
  // endpoint, which assigns the matter number and seeds the checklist.
  const stageIsMutable = lead.lead_status in MUTABLE_LEAD_STATUS_LABEL
  const stageLabel = lead.lead_status.charAt(0).toUpperCase() + lead.lead_status.slice(1)

  const [draft, setDraft] = useState<unknown>(null)
  const [savingField, setSavingField] = useState<LeadEditableField | null>(null)
  const [savedField, setSavedField] = useState<LeadEditableField | null>(null)
  const [fieldError, setFieldError] = useState<FieldErrorState | null>(null)
  const [showOptionalNames, setShowOptionalNames] = useState(false)
  const [openGroups, setOpenGroups] = useState<string[]>(['Contact'])
  const initializedFieldRef = useRef<LeadEditableField | null>(null)
  const activeRowRef = useRef<HTMLDivElement | null>(null)
  const lastPersistedRef = useRef<unknown>(null)
  const savingRef = useRef(false)
  const suppressSpouseBlurRef = useRef(false)
  const removeSpouseButtonRef = useRef<HTMLButtonElement | null>(null)
  const triggerRefs = useRef<Partial<Record<LeadEditableField, HTMLButtonElement | null>>>({})

  useEffect(() => {
    if (!activeField) {
      initializedFieldRef.current = null
      return
    }
    if (initializedFieldRef.current === activeField) return
    initializedFieldRef.current = activeField
    setFieldError(null)
    const group = LEAD_FIELD_GROUPS.find(group => group.keys.includes(isNameField(activeField) ? 'firstName' : activeField))
    if (group) setOpenGroups(current => current.includes(group.title) ? current : [...current, group.title])
    requestAnimationFrame(() => {
      activeRowRef.current?.scrollIntoView?.({ block: 'nearest' })
      activeRowRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
    })
    const rawPersisted = valueForLeadField(activeField, lead, spouse)
    const persisted = activeField === 'phone'
      ? formatPhoneInput(String(rawPersisted ?? ''))
      : rawPersisted
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
    setFieldError(null)
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
      setSavingField(null)
      setSavedField(null)
      setFieldError({
        field,
        message: error instanceof Error ? error.message : 'Could not save field',
      })
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
    if (!fieldError) void commitField(field)
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
            <label className="space-y-1"><FieldLabel>Spouse phone</FieldLabel><Input type="tel" aria-label="Spouse phone" disabled={disabled} value={spouseDraft.phone} onChange={event => update('phone', formatPhoneInput(event.target.value))} placeholder="(555) 555-5555" /></label>
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

    if (field.input === 'date') {
      // A date input reads back as "" until all three segments are filled, so a
      // blank here is mid-entry rather than a cleared date, and must not commit.
      // Nor may every non-blank value: the browser reports a complete date the
      // instant the segments are populated, so a year still being typed arrives
      // as 0002, then 0020, then 0202. Committing those closed the row after
      // one segment and persisted the first of them — `isSettledDateEntry`
      // waits for the whole year. Clearing still works, through blur or Enter.
      return (
        <div {...sharedContainerProps}>
          <Input
            autoFocus
            aria-label={field.label}
            className="h-8"
            disabled={disabled}
            type="date"
            value={String(draft ?? '')}
            onChange={event => {
              const next = event.target.value
              setDraft(next)
              if (isSettledDateEntry(next)) void commitField(field.key, next)
            }}
          />
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
          onChange={event => setDraft(
            field.key === 'phone' ? formatPhoneInput(event.target.value) : event.target.value,
          )}
        />
      </div>
    )
  }

  /** The name row splits into one trigger per populated component. */
  function renderNameValue() {
    // A blank middle or preferred name stays out of the row until asked for.
    const components = NAME_COMPONENTS.filter(component =>
      showOptionalNames
      || !('optional' in component && component.optional)
      || hasText(lead[component.property]),
    )
    const hiddenCount = NAME_COMPONENTS.length - components.length
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {components.map(component => {
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
        {hiddenCount > 0 && (
          <button
            aria-label="Show middle and preferred name"
            className="rounded-full border border-dashed border-border px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            disabled={activeField !== null}
            type="button"
            onClick={() => setShowOptionalNames(true)}
          >
            + More
          </button>
        )}
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
          'flex min-h-10 flex-wrap items-start gap-2 border-b border-muted py-2 last:border-b-0',
          // Editors (address, spouse) need the full row even in the two-column
          // layout the rail uses once it is wide enough.
          active && '@2xl/rail:col-span-2',
        )}
        key={field.key}
        ref={active ? activeRowRef : undefined}
      >
        <span className="w-[108px] shrink-0 pt-1 text-sm text-muted-foreground">{field.label}</span>
        <div className="min-w-0 flex-1">
          {active ? (
            <>
              {renderEditor(editedField)}
              {fieldError?.field === editedField.key ? (
                <div className="mt-2 space-y-2">
                  <p id={`lead-${editedField.key}-error`} role="alert" className="text-sm text-destructive">{fieldError.message}</p>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={savingField !== null} onClick={() => void commitField(editedField.key)}>Retry</Button>
                    <Button type="button" size="sm" variant="outline" disabled={savingField !== null} onClick={() => cancelField(editedField.key)}>Cancel</Button>
                  </div>
                </div>
              ) : <p className="mt-1 text-xs text-muted-foreground">Enter to save · Esc to cancel</p>}
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
    <div
      data-detail-content="Lead details"
      className={cn(
        '@container/rail flex h-full w-full flex-col overflow-y-auto bg-card p-4',
        className,
      )}
      onPointerDownCapture={event => {
        if (event.target instanceof HTMLButtonElement && event.target.disabled) {
          event.preventDefault()
        }
      }}
    >
      {onStageChange && (
        <section className="mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Stage
          </h3>
          {stageIsMutable ? (
            <select
              aria-label="Stage"
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
              disabled={stageBusy}
              value={lead.lead_status}
              onChange={event => onStageChange(event.target.value as MutableLeadStatus)}
            >
              {Object.entries(MUTABLE_LEAD_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          ) : (
            <>
              <p className="mt-1 text-sm font-medium">{stageLabel}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Hiring runs through convert, so this stage is not set by hand.
              </p>
            </>
          )}
        </section>
      )}

      <LeadReadinessDial lead={lead} spouse={spouse} />

      <div className="mt-4 space-y-4">
        {LEAD_FIELD_GROUPS.map(group => {
          const definitions = group.keys
            .map(key => leadFieldDefinition(key))
            .filter((definition): definition is LeadFieldDefinition => Boolean(definition))
            .filter(definition => leadFieldApplies(definition, lead))
          // Legal plan only applies to the LP track, so its whole section —
          // heading included — stays off a plain EP or Probate lead.
          if (definitions.length === 0) return null
          return (
            <section key={group.title}>
              <h3>
                <button type="button" className="flex min-h-10 w-full items-center justify-between text-sm font-semibold" aria-expanded={openGroups.includes(group.title)} onClick={() => setOpenGroups(current => current.includes(group.title) ? current.filter(title => title !== group.title) : [...current, group.title])}>
                  {group.title}<span aria-hidden>{openGroups.includes(group.title) ? '−' : '+'}</span>
                </button>
              </h3>
              <div hidden={!openGroups.includes(group.title)} className={cn("mt-1", openGroups.includes(group.title) && "@2xl/rail:grid @2xl/rail:grid-cols-2 @2xl/rail:gap-x-6")}>
                {definitions.map(renderRow)}
              </div>
            </section>
          )
        })}
      </div>

      <LeadEstateTaxCard className="mt-4" lead={lead} onOpenField={onActiveFieldChange} />

      {statusLabel && (
        <span aria-label={`${statusLabel} save status`} aria-live="polite" className="mt-2 block text-[11px] text-muted-foreground" role="status">
          {savingField ? 'Saving' : 'Saved'}
        </span>
      )}

      {displayedFieldError && (spouseRemovalError || displayedFieldError.field !== activeField) && (
        <p className="mt-2 text-xs text-destructive" id={`lead-${displayedFieldError.field}-error`} role="alert">
          {displayedFieldError.message}
        </p>
      )}

      <footer className="pt-2">
        <p className="text-[11px] text-muted-foreground">
          Intake answers land here automatically — you rarely need to type these.
        </p>
        <MatterAssistantQuickPrompts className="mt-1.5 flex flex-wrap gap-2" prompts={ASSISTANT_PROMPTS} />
      </footer>
    </div>
  )
}
