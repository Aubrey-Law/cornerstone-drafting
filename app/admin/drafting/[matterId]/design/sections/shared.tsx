'use client'

import { createContext, forwardRef, useContext, useImperativeHandle, useRef } from 'react'
import { CircleAlert as AlertCircle, CircleHelp as HelpCircle, TriangleAlert as AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatAgeLabel, toDateInputValue } from '@/lib/dob'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import type { DesignSheet } from '@/types/database'
import type { SlotState } from '@/types/planReview'

// ── Shared props ──────────────────────────────────────────────────────────────

export type DesignSheetOnChange = <K extends keyof DesignSheet>(
  field: K,
  value: DesignSheet[K] | ((previous: DesignSheet) => DesignSheet[K]),
) => void

export interface SectionProps {
  sheet: DesignSheet
  onChange: DesignSheetOnChange
}

// ── Field-level validation ─────────────────────────────────────────────────────
// Readiness blockers (lib/designSheetReadiness) surface in the rail/blocker list.
// This context lets the shared inputs also flag themselves inline once the
// attorney has touched (blurred) a field that's still a drafting blocker.

interface DesignValidationContextValue {
  blockedFields: Set<string>
  touched: Set<string>
  markTouched: (field: string) => void
}

const DesignValidationContext = createContext<DesignValidationContextValue>({
  blockedFields: new Set(),
  touched: new Set(),
  markTouched: () => {},
})

export function DesignValidationProvider({ value, children }: {
  value: DesignValidationContextValue
  children: React.ReactNode
}) {
  return (
    <DesignValidationContext.Provider value={value}>
      {children}
    </DesignValidationContext.Provider>
  )
}

function useFieldValidation(fieldName?: keyof DesignSheet | string) {
  const ctx = useContext(DesignValidationContext)
  const name = fieldName != null ? String(fieldName) : undefined
  const showError = name != null && ctx.blockedFields.has(name) && ctx.touched.has(name)
  const onBlur = name != null ? () => ctx.markTouched(name) : undefined
  return { showError, onBlur }
}

function RequiredForDraftingNote() {
  return (
    <p className="mt-1 text-[10.5px] font-medium text-destructive">Required for drafting</p>
  )
}

// Re-export from shared field registry — single source of truth with portal intake.
export { PRONOUN_OPTIONS } from '@/lib/sharedFields/options'

// ── Field label ───────────────────────────────────────────────────────────────

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
      {children}
    </p>
  )
}

export function FieldHelpLabel({ children, help }: { children: React.ReactNode; help: string }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">{children}</p>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Help"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {help}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function DesignSheetCheckboxOption({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <Checkbox checked={checked} onCheckedChange={value => onChange(value === true)} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  )
}

export interface DecisionRowOption<T extends string> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}

export function DecisionRow<T extends string>({
  question,
  help,
  value,
  options,
  onChange,
  blocking = false,
  fieldName,
}: {
  question: string
  help?: string
  value: T | null | undefined
  options: readonly DecisionRowOption<T>[]
  onChange: (value: T) => void
  blocking?: boolean
  fieldName?: keyof DesignSheet | string
}) {
  const { showError, onBlur } = useFieldValidation(fieldName)
  return (
    <div
      id={fieldId(fieldName)}
      data-design-field={fieldName ? String(fieldName) : undefined}
      className={cn(
        'grid gap-3 border-b border-border py-4 last:border-b-0 md:grid-cols-[232px_minmax(0,1fr)]',
        showError && 'rounded-md bg-destructive/5 px-3',
      )}
      onBlur={onBlur}
    >
      <div>
        <p className="text-sm font-semibold text-foreground">{question}</p>
        {help ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{help}</p> : null}
        {blocking ? (
          <span className="mt-2 inline-flex rounded-full border border-[var(--gi-amber-border)] bg-[var(--gi-amber-bg)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--gi-amber)]">
            Blocks drafting
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap content-start gap-2" role="group" aria-label={question}>
        {options.map(option => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={option.disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                selected
                  ? 'border-[var(--gi-teal)] bg-[color-mix(in_srgb,var(--gi-teal)_10%,transparent)] font-semibold text-[var(--gi-teal-deep)]'
                  : 'border-border bg-card text-foreground hover:border-[var(--gi-teal)]',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="block">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block max-w-64 text-[11px] font-normal leading-snug text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      {showError ? <RequiredForDraftingNote /> : null}
    </div>
  )
}

export function yesNoField(value: string | null | undefined): boolean {
  return (value ?? '').toLowerCase() === 'yes'
}

export function toYesNo(checked: boolean): 'yes' | 'no' {
  return checked ? 'yes' : 'no'
}

export function DobAgeHint({ dob }: { dob: string | null | undefined }) {
  const label = formatAgeLabel(dob)
  if (!label) return null
  return (
    <p className="mt-1 text-[10.5px] font-medium text-muted-foreground">{label}</p>
  )
}

// ── Slot state toggle ─────────────────────────────────────────────────────────

const SLOT_STATE_OPTIONS: { value: SlotState; label: string }[] = [
  { value: 'filled', label: 'Filled' },
  { value: 'pending_client', label: 'Pending client' },
  { value: 'optional', label: 'Optional' },
]

export function SlotStateToggle({ slotKey: _slotKey, state, onChange }: {
  slotKey: string
  state: SlotState
  onChange: (s: SlotState) => void
}) {
  return (
    <div className="mb-2 flex items-center rounded-md bg-muted p-0.5 w-fit gap-0.5">
      {SLOT_STATE_OPTIONS.map(opt => {
        const isActive = state === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded px-2 py-0.5 transition-all text-[10px] leading-tight font-medium',
              isActive && opt.value === 'filled' && 'bg-card text-foreground shadow-sm',
              isActive && opt.value === 'pending_client' && 'bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-900/40 dark:text-amber-300',
              isActive && opt.value === 'optional' && 'bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-900/40 dark:text-blue-300',
              !isActive && 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Field inputs ──────────────────────────────────────────────────────────────

function displayOriginalValue(value: string | null | undefined) {
  const text = value?.trim()
  return text ? text : 'Blank'
}

function OverrideIndicator({ originalValue, className = 'right-2.5' }: {
  originalValue: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          'absolute top-1/2 -translate-y-1/2 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-warning/40 text-warning cursor-help',
          className,
        )}>
          <AlertCircle className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">Attorney override</p>
        <p className="text-muted-foreground">Prefilled: {displayOriginalValue(originalValue)}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function PrefilledValueNote({ originalValue }: { originalValue: string }) {
  return (
    <p className="mt-1 text-[10.5px] font-medium text-warning">
      Prefilled: {displayOriginalValue(originalValue)}
    </p>
  )
}

function fieldId(fieldName?: keyof DesignSheet | string) {
  return fieldName ? designFieldTargetId(String(fieldName)) : undefined
}

export function PrefilledInput({ label, value, originalValue, onChange, type = 'text', fieldName }: {
  label: string
  value: string
  originalValue?: string
  onChange?: (v: string) => void
  type?: string
  fieldName?: keyof DesignSheet | string
}) {
  const isOverride = originalValue !== undefined
  const { showError, onBlur } = useFieldValidation(fieldName)
  const inputValue = type === 'date' ? toDateInputValue(value) : value
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={fieldId(fieldName)}
          data-design-field={fieldName ? String(fieldName) : undefined}
          type={type}
          value={inputValue}
          onChange={e => onChange?.(e.target.value)}
          onBlur={onBlur}
          className={cn(
            'text-foreground',
            isOverride ? 'bg-warning/10 border-warning/40 pr-8' : 'bg-muted border-border',
            showError && 'border-destructive bg-destructive/5',
          )}
        />
        {isOverride && <OverrideIndicator originalValue={originalValue} />}
      </div>
      {isOverride && <PrefilledValueNote originalValue={originalValue} />}
      {showError && <RequiredForDraftingNote />}
    </div>
  )
}

export function OverriddenInput({ label, value, originalValue, onChange, fieldName }: {
  label: string
  value: string
  originalValue: string
  onChange?: (v: string) => void
  fieldName?: keyof DesignSheet | string
}) {
  const { showError, onBlur } = useFieldValidation(fieldName)
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={fieldId(fieldName)}
          data-design-field={fieldName ? String(fieldName) : undefined}
          value={value}
          onChange={e => onChange?.(e.target.value)}
          onBlur={onBlur}
          className={cn(
            'bg-warning/10 border-warning/40 text-foreground pr-8',
            showError && 'border-destructive bg-destructive/5',
          )}
        />
        <OverrideIndicator originalValue={originalValue} />
      </div>
      <PrefilledValueNote originalValue={originalValue} />
      {showError && <RequiredForDraftingNote />}
    </div>
  )
}

export function OverriddenSelect({ label, value, originalValue, options, onChange, fieldName }: {
  label: string
  value: string
  originalValue: string
  options: { value: string; label: string }[]
  onChange?: (v: string) => void
  fieldName?: keyof DesignSheet | string
}) {
  const { showError, onBlur } = useFieldValidation(fieldName)
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Select value={value} onValueChange={v => onChange?.(v)}>
          <SelectTrigger
            id={fieldId(fieldName)}
            data-design-field={fieldName ? String(fieldName) : undefined}
            onBlur={onBlur}
            className={cn(
              'bg-warning/10 border-warning/40 text-foreground pr-10',
              showError && 'border-destructive bg-destructive/5',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <OverrideIndicator originalValue={originalValue} className="right-8" />
      </div>
      <PrefilledValueNote originalValue={originalValue} />
      {showError && <RequiredForDraftingNote />}
    </div>
  )
}

export function PrefilledSelect({ label, value, originalValue, options, onChange, fieldName }: {
  label: string
  value: string
  originalValue?: string
  options: { value: string; label: string }[]
  onChange?: (v: string) => void
  fieldName?: keyof DesignSheet | string
}) {
  const isOverride = originalValue !== undefined
  const { showError, onBlur } = useFieldValidation(fieldName)
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <Select value={value} onValueChange={v => onChange?.(v)}>
          <SelectTrigger
            id={fieldId(fieldName)}
            data-design-field={fieldName ? String(fieldName) : undefined}
            onBlur={onBlur}
            className={cn(
              'text-foreground',
              isOverride ? 'bg-warning/10 border-warning/40 pr-10' : 'bg-muted border-border',
              showError && 'border-destructive bg-destructive/5',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isOverride && <OverrideIndicator originalValue={originalValue} className="right-8" />}
      </div>
      {isOverride && <PrefilledValueNote originalValue={originalValue} />}
      {showError && <RequiredForDraftingNote />}
    </div>
  )
}

export function AttorneyInput({ label, value, placeholder, onChange, fieldName, type = 'text' }: {
  label: string
  value: string
  placeholder?: string
  onChange?: (v: string) => void
  fieldName?: keyof DesignSheet | string
  type?: string
}) {
  const { showError, onBlur } = useFieldValidation(fieldName)
  const inputValue = type === 'date' ? toDateInputValue(value) : value
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Input
        id={fieldId(fieldName)}
        data-design-field={fieldName ? String(fieldName) : undefined}
        type={type}
        value={inputValue}
        placeholder={type === 'date' ? undefined : placeholder}
        onChange={e => onChange?.(e.target.value)}
        onBlur={onBlur}
        className={cn(
          'bg-card border-border text-foreground',
          showError && 'border-destructive bg-destructive/5',
        )}
      />
      {showError && <RequiredForDraftingNote />}
    </div>
  )
}

/** Attorney-only date field using the native date picker (`YYYY-MM-DD` storage). */
export function AttorneyDateInput({
  label,
  value,
  onChange,
  fieldName,
}: {
  label: string
  value: string
  onChange?: (v: string) => void
  fieldName?: keyof DesignSheet | string
}) {
  return (
    <AttorneyInput
      label={label}
      value={value}
      onChange={onChange}
      fieldName={fieldName}
      type="date"
    />
  )
}

export function AttorneySelect({ label, value, options, placeholder, onChange, fieldName }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  placeholder?: string
  onChange?: (v: string) => void
  fieldName?: keyof DesignSheet | string
}) {
  const { showError, onBlur } = useFieldValidation(fieldName)
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={v => onChange?.(v)}>
        <SelectTrigger
          id={fieldId(fieldName)}
          data-design-field={fieldName ? String(fieldName) : undefined}
          onBlur={onBlur}
          className={cn(
            'bg-card border-border text-foreground',
            showError && 'border-destructive bg-destructive/5',
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showError && <RequiredForDraftingNote />}
    </div>
  )
}

// ── Section chrome ────────────────────────────────────────────────────────────

/** Standard field grid — responsive 2-up on small screens, avoids cramped 4-col rows. */
export const sectionFieldGrid2 = 'grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'
export const sectionFieldGrid3 = 'grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'
export const sectionFieldGrid4 = 'grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4'

export function DesignSectionContent({ children }: { children: React.ReactNode }) {
  return <div className="design-section-content [&>.rounded-lg:last-child]:mb-0">{children}</div>
}

const GroupCardContext = createContext(false)

export function GroupCard({
  id,
  title,
  summary,
  headerAction,
  blockingCount,
  optionalCount,
  blockingLabels = [],
  optionalLabels = [],
  collapsed = false,
  onCollapsedChange,
  children,
  scrollMarginTop,
}: {
  id: string
  title: string
  summary: string
  headerAction?: React.ReactNode
  blockingCount: number
  optionalCount: number
  /** Names of the open decisions; the count alone doesn't say which they are. */
  blockingLabels?: string[]
  optionalLabels?: string[]
  /** Collapsible only when `onCollapsedChange` is provided; sectioned mode forces the card open. */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  children: React.ReactNode
  scrollMarginTop?: number
}) {
  const collapsible = Boolean(onCollapsedChange)
  const isCollapsed = collapsible && collapsed
  const openCount = blockingCount > 0 ? blockingCount : optionalCount
  const openLabel = blockingCount > 0 ? 'blocking' : 'optional'
  const openNames = blockingCount > 0 ? blockingLabels : optionalLabels
  const header = (
    <>
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
    </>
  )
  return (
    <section
      id={id}
      className="mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      style={{ scrollMarginTop }}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        {collapsible ? (
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            aria-expanded={!isCollapsed}
            aria-controls={`${id}-content`}
            onClick={() => onCollapsedChange?.(!isCollapsed)}
          >
            {header}
          </button>
        ) : (
          <div className="min-w-0 flex-1 text-left">{header}</div>
        )}
        {headerAction}
        {openCount > 0 ? (
          <span className={cn(
            'rounded-full border px-2 py-1 text-[10px] font-semibold',
            blockingCount > 0
              ? 'border-[var(--gi-amber-border)] bg-[var(--gi-amber-bg)] text-[var(--gi-amber)]'
              : 'border-border bg-muted text-muted-foreground',
          )}>
            {openCount} {openLabel}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Set
          </span>
        )}
        {collapsible ? (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
            aria-expanded={!isCollapsed}
            aria-controls={`${id}-content`}
            onClick={() => onCollapsedChange?.(!isCollapsed)}
          >
            {isCollapsed
              ? <ChevronRight className="h-4 w-4" />
              : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {openCount > 0 && openNames.length > 0 && !isCollapsed ? (
        <div className="border-t border-border bg-muted/30 px-5 py-2">
          <p className="text-[11px] leading-4 text-muted-foreground">
            <span className="font-semibold text-foreground">
              Still {blockingCount > 0 ? 'required' : 'open'}:
            </span>{' '}
            {openNames.join(' · ')}
          </p>
        </div>
      ) : null}
      <div
        id={`${id}-content`}
        className={cn('border-t border-border px-5 py-5', isCollapsed && 'hidden')}
        aria-hidden={isCollapsed}
      >
        <GroupCardContext.Provider value>
          {children}
        </GroupCardContext.Provider>
      </div>
    </section>
  )
}

export function SectionBlock({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  const insideGroupCard = useContext(GroupCardContext)
  return (
    <section className={cn(
      'mb-6 last:mb-0',
      !insideGroupCard && 'rounded-lg border border-border bg-card p-4 sm:p-5',
    )}>
      <div className="mb-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

export function AttorneyNoteBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 dark:border-amber-700/50 dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning dark:text-amber-400" />
      <p className="text-[13px] leading-relaxed text-warning dark:text-amber-200">{children}</p>
    </div>
  )
}

export function ClientDecisionCallout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/30">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300">
        Client decision required — {children}
      </span>
    </div>
  )
}


// ── Accordion section ────────────────────────────────────────────────────────

export interface AccordionSectionHandle {
  scrollIntoView: () => void
}

interface AccordionSectionProps {
  id: string
  title: string
  icon: React.ReactNode
  badge?: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

export const AccordionSection = forwardRef<AccordionSectionHandle, AccordionSectionProps>(
  function AccordionSection({ id, title, icon, badge, isOpen, onToggle, children }, ref) {
    const rootRef = useRef<HTMLDivElement>(null)
    const headerRef = useRef<HTMLButtonElement>(null)

    useImperativeHandle(ref, () => ({
      scrollIntoView() {
        const el = headerRef.current ?? rootRef.current
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    }))

    return (
      <div
        ref={rootRef}
        id={id}
        className="mb-3 scroll-mt-4 rounded-[var(--radius)] border-[0.5px] border-border bg-card"
      >
        {/* Header */}
        <button
          ref={headerRef}
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-[1.125rem] py-[0.8rem] text-left transition-colors hover:bg-muted cursor-pointer rounded-[var(--radius)]"
        >
          <span
            className={cn(
              'flex h-[1.75rem] w-[1.75rem] shrink-0 items-center justify-center rounded-[calc(var(--radius)-2px)] transition-colors',
              isOpen ? 'bg-accent/12' : 'bg-secondary'
            )}
          >
            {icon}
          </span>
          <span className="flex-1 font-[family-name:var(--font-display)] text-[0.875rem] font-medium text-foreground">
            {title}
          </span>
          {badge}
          <ChevronDown
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {/* Body */}
        {isOpen && (
          <div className="border-t-[0.5px] border-border px-[1.125rem] py-5">
            {children}
          </div>
        )}
      </div>
    )
  }
)

export function AccordionBadge({ variant = 'core', children }: {
  variant?: 'core' | 'warn' | 'lp'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-[0.4rem] py-[0.125rem] text-[0.625rem] font-medium',
        variant === 'core' && 'bg-muted text-muted-foreground',
        variant === 'warn' && 'bg-warning/10 text-warning',
        variant === 'lp' && 'bg-accent/10 text-accent',
      )}
    >
      {children}
    </span>
  )
}

// ── Inheritance card ──────────────────────────────────────────────────────────

export function InheritanceCard({ title, description, selected, onClick }: {
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start rounded-lg border-2 p-4 text-left transition-colors',
        selected
          ? 'border-accent bg-accent/10'
          : 'border-border bg-card hover:border-muted-foreground'
      )}
    >
      <div className={cn(
        'mb-2 flex h-5 w-5 items-center justify-center rounded-full border-2',
        selected ? 'border-accent bg-accent' : 'border-border'
      )}>
        {selected && <Check className="h-3 w-3 text-white" />}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-foreground">{description}</p>
    </button>
  )
}

/**
 * Placeholder body for design-sheet sections that exist in the attorney design
 * instrument but whose fields haven't been wired into the editor yet. Keeps the
 * 20-section structure visible while the fields land in a later phase.
 */
export function SectionPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-5 text-sm">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{note}</p>
    </div>
  )
}
