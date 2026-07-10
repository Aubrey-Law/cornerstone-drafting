'use client'

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Save, ChevronRight, Plus, Trash2, Info, X } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useAutoSave, type SaveStatus } from '@/hooks/useAutoSave'
import { useContacts } from '@/hooks/useContacts'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { composedAddressOneLine, wizardStreetLine } from '@/lib/intakeContactAddress'
import { ContactPickerField } from '@/components/intake/FiduciaryContactPicker'
import { IntakeDocumentUpload, IntakeQuestionnaireReview } from '@/components/intake/IntakeQuestionnaireReview'
import { formatPhoneInput } from '@/lib/phone'
import { IntakeField } from '@/components/sharedFields/IntakeField'
import {
  INTAKE_ASSET_TOTALS_KEYS,
  INTAKE_ASSET_TYPE_OPTIONS,
  INTAKE_ASSET_TYPE_VALUES,
  LEGAL_INSURANCE_PLAN_OPTIONS,
  MA_COUNTY_OPTIONS,
  PLANNING_GOAL_OPTIONS,
  PRONOUN_OPTIONS,
  CHILD_RELATIONSHIP_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
  SPECIAL_CIRCUMSTANCE_OPTIONS,
  SUFFIX_OPTIONS,
  assetTypeLabel,
  type IntakeAssetTotalsKey,
} from '@/lib/sharedFields'
// ─── Brand Colors ──────────────────────────────────────────────
const NAVY = '#1f2d5a'
const TEAL = '#1b6b72'

const SUFFIXES = SUFFIX_OPTIONS.map((o) => o.value)
const INTAKE_SUFFIX_SELECT_OPTIONS = SUFFIX_OPTIONS

/** Client mailing address segments for fiduciary “household contact” stubs. */
function intakeResidentialAddress(data: Record<string, unknown>): {
  line: string
  city: string
  state: string
  zip: string
  composed: string
} {
  const line = wizardStreetLine(data)
  const city = typeof data.city === 'string' ? data.city.trim() : ''
  const state = typeof data.state === 'string' ? data.state.trim() : ''
  const zip = typeof data.zip === 'string' ? data.zip.trim() : ''
  const composed =
    composedAddressOneLine({ street: line, city, state, zip }) || ''
  return { line, city, state, zip, composed }
}

// ─── Reusable Form Components ──────────────────────────────────
function FormField({
  label,
  children,
  className,
  optional,
}: {
  label: string
  children: ReactNode
  className?: string
  optional?: boolean
}) {
  const controlId = useId()
  const child = isValidElement(children) && children.type !== 'div'
    ? cloneElement(children as ReactElement<{ id?: string }>, { id: (children.props as { id?: string }).id ?? controlId })
    : children
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={controlId} className="block text-sm font-medium text-gray-700">
        {label}
        {optional && <span className="ml-1 font-normal text-gray-400">(optional)</span>}
      </label>
      {child}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
  id,
}: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  type?: string
  required?: boolean
  id?: string
}) {
  return (
    <input
      id={id}
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    />
  )
}

// ─── Phone Input (auto-formats to (xxx) xxx-xxxx) ─────────────
function PhoneInput({
  value,
  onChange,
  placeholder = '(555) 123-4567',
  id,
}: {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  id?: string
}) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(formatPhoneInput(e.target.value))
  }

  return (
    <input
      id={id}
      type="tel"
      value={value ?? ''}
      onChange={handleChange}
      placeholder={placeholder}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    />
  )
}

// ─── Address Search (Google Places through our first-party API) ────
interface PlaceAutocompleteResult {
  place_id: string
  description: string
  structured_formatting?: {
    main_text?: string
    secondary_text?: string
  }
}

interface PlaceDetailsResult {
  address_line1?: string
  city?: string
  state?: string
  zip?: string
  county?: string
}

interface ParsedAddress {
  street: string
  city: string
  state: string
  zip: string
  county: string
}

function AddressSearch({ onSelect }: { onSelect: (addr: ParsedAddress) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceAutocompleteResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.length < 5) {
      setResults([])
      setOpen(false)
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/places?action=autocomplete&input=${encodeURIComponent(query)}`)
        if (!res.ok) {
          setResults([])
          setOpen(false)
          return
        }
        const data: PlaceAutocompleteResult[] = await res.json()
        const predictions = Array.isArray(data) ? data : []
        setResults(predictions)
        setOpen(predictions.length > 0)
      } catch {
        // silently fail — user can still type manually
      } finally {
        setLoading(false)
      }
    }, 500)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [query])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSelect(result: PlaceAutocompleteResult) {
    setLoading(true)
    try {
      const res = await fetch(`/api/places?action=details&place_id=${encodeURIComponent(result.place_id)}`)
      if (!res.ok) throw new Error('Address details lookup failed')
      const details: PlaceDetailsResult = await res.json()
      const street = (details.address_line1 ?? '').trim()
      const city = (details.city ?? '').trim()
      const state = (details.state ?? '').trim()
      const zip = (details.zip ?? '').trim()
      const county = (details.county ?? '').replace(/ County$/i, '').trim()
      onSelect({ street, city, state, zip, county })
      setQuery(street || result.structured_formatting?.main_text || result.description.split(',')[0] || '')
    } catch {
      setQuery(result.structured_formatting?.main_text || result.description.split(',')[0] || '')
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Start typing an address to search…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {loading && (
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {results.map((r) => {
            const line1 = r.structured_formatting?.main_text || r.description.split(',')[0] || r.description
            const line2 =
              r.structured_formatting?.secondary_text ||
              r.description.split(',').slice(1).join(',').trim()
            return (
              <li key={r.place_id}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(r) }}
                  className="flex w-full flex-col px-4 py-2.5 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{line1}</span>
                  <span className="text-xs text-gray-500">{line2}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  id,
}: {
  value: string
  onChange: (val: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  id?: string
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
          checked ? 'bg-accent' : 'bg-gray-200'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

function Row2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}

function SectionDivider({ title }: { title?: string }) {
  return (
    <div className="relative py-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-gray-200" />
      </div>
      {title && (
        <div className="relative flex justify-start">
          <span className="bg-white pr-3 text-sm font-medium text-gray-500">{title}</span>
        </div>
      )}
    </div>
  )
}

function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
      <div className="text-sm text-blue-800">{children}</div>
    </div>
  )
}

function WhyWeAsk({ children }: { children: ReactNode }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-xs font-medium text-accent hover:underline">
        Why we ask
      </summary>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">{children}</p>
    </details>
  )
}

function ExpandableHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-800">{title}</summary>
      <div className="mt-3 space-y-3 text-sm text-gray-600">{children}</div>
    </details>
  )
}

function ReviewChoiceControl({
  data,
  update,
  choiceKey,
  label,
}: {
  data: Record<string, unknown>
  update: (field: string, value: unknown) => void
  choiceKey: string
  label: string
}) {
  const choices = (
    data._review_choices && typeof data._review_choices === 'object' && !Array.isArray(data._review_choices)
      ? data._review_choices
      : {}
  ) as Record<string, string>
  const current = choices[choiceKey] ?? ''

  function choose(value: 'discuss_with_attorney' | 'not_provided_yet') {
    update('_review_choices', {
      ...choices,
      [choiceKey]: current === value ? '' : value,
    })
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-950">{label}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={current === 'discuss_with_attorney'}
          onClick={() => choose('discuss_with_attorney')}
          className={cn(
            'rounded-md border px-3 py-2 text-left text-sm transition-colors',
            current === 'discuss_with_attorney'
              ? 'border-amber-700 bg-white text-amber-950'
              : 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-white',
          )}
        >
          Discuss with attorney
        </button>
        <button
          type="button"
          aria-pressed={current === 'not_provided_yet'}
          onClick={() => choose('not_provided_yet')}
          className={cn(
            'rounded-md border px-3 py-2 text-left text-sm transition-colors',
            current === 'not_provided_yet'
              ? 'border-amber-700 bg-white text-amber-950'
              : 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-white',
          )}
        >
          Not provided yet
        </button>
      </div>
    </div>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-800"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  )
}

// ─── ContactAddressFields ──────────────────────────────────────
function ContactAddressFields({
  street,
  city,
  state,
  zip,
  county,
  onStreetChange,
  onCityChange,
  onStateChange,
  onZipChange,
  onCountyChange,
  onAddressSelect,
}: {
  street: string
  city: string
  state: string
  zip: string
  county: string
  onStreetChange: (v: string) => void
  onCityChange: (v: string) => void
  onStateChange: (v: string) => void
  onZipChange: (v: string) => void
  onCountyChange: (v: string) => void
  onAddressSelect: (addr: ParsedAddress) => void
}) {
  return (
    <div className="space-y-3">
      <FormField label="Search Address">
        <AddressSearch onSelect={onAddressSelect} />
      </FormField>
      <FormField label="Street Address">
        <TextInput value={street} onChange={onStreetChange} />
      </FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FormField label="City" className="sm:col-span-2">
          <TextInput value={city} onChange={onCityChange} />
        </FormField>
        <FormField label="State">
          <TextInput value={state} onChange={onStateChange} />
        </FormField>
        <FormField label="ZIP">
          <TextInput value={zip} onChange={onZipChange} />
        </FormField>
      </div>
      {county !== undefined && (
        <FormField label="County">
          <SelectInput
            value={county}
            onChange={onCountyChange}
            placeholder="Select county"
            options={MA_COUNTY_OPTIONS}
          />
        </FormField>
      )}
    </div>
  )
}

// ─── Types ─────────────────────────────────────────────────────
export interface FiduciaryEntry {
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  relationship: string
  phone: string
  email: string
  address: string
  street: string
  city: string
  state: string
  zip: string
  priority: number
  contact_id?: string
  is_coagent?: boolean
  [key: string]: unknown
}

// ─── Fiduciary Role Component ──────────────────────────────────
// Data model: entries is a flat array.
//   Principals:  is_coagent=false, priority=1 (primary), 2 (alt 1), 3 (alt 2) ...
//   Co-agents:   is_coagent=true,  priority=same as the principal they serve with
// Each principal can optionally have one co-agent paired by matching priority.
// HCP does not support co-agents (pass allowCoAgent={false}).
function FiduciaryRole({
  title,
  description,
  example,
  entries,
  onChange,
  intakeId,
  allLocalContacts = [],
  allowCoAgent = true,
}: {
  title: string
  description: string
  example?: string
  entries: FiduciaryEntry[]
  onChange: (entries: FiduciaryEntry[]) => void
  intakeId: string
  allLocalContacts?: FiduciaryEntry[]
  allowCoAgent?: boolean
}) {
  const principals = entries.filter(e => !e.is_coagent)
  const canAddAlternate = principals.length < 5

  function coagentFor(principalPriority: number): FiduciaryEntry | undefined {
    return entries.find(e => e.is_coagent && e.priority === principalPriority)
  }

  function indexInEntries(e: FiduciaryEntry): number {
    return entries.indexOf(e)
  }

  function updateEntry(index: number, updated: FiduciaryEntry) {
    const next = [...entries]
    next[index] = updated
    onChange(next)
  }

  function addCoAgentFor(principalPriority: number) {
    onChange([...entries, { ...DEFAULT_FIDUCIARY_ENTRY, priority: principalPriority, is_coagent: true }])
  }

  function addAlternate() {
    if (!canAddAlternate) return
    const nextPriority = principals.length + 1
    onChange([...entries, { ...DEFAULT_FIDUCIARY_ENTRY, priority: nextPriority, is_coagent: false }])
  }

  function removeEntry(entryToRemove: FiduciaryEntry) {
    // If removing a principal, also remove its co-agent
    const toRemove = new Set<FiduciaryEntry>([entryToRemove])
    if (!entryToRemove.is_coagent) {
      const ca = coagentFor(entryToRemove.priority)
      if (ca) toRemove.add(ca)
    }
    const remaining = entries.filter(e => !toRemove.has(e))
    // Re-number principal priorities and re-link co-agents
    let altPriority = 2
    const principalPriorityMap = new Map<number, number>()
    const renumbered = remaining.map(e => {
      if (!e.is_coagent) {
        const newPriority = e.priority === 1 ? 1 : altPriority++
        principalPriorityMap.set(e.priority, newPriority)
        return { ...e, priority: newPriority }
      }
      return e
    }).map(e => {
      if (e.is_coagent) {
        const newPriority = principalPriorityMap.get(e.priority) ?? e.priority
        return { ...e, priority: newPriority }
      }
      return e
    })
    onChange(renumbered)
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <p className="text-xs text-gray-500">{description}</p>
        {example && (
          <p className="mt-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
            <span className="font-medium text-gray-700">Example: </span>
            {example}
          </p>
        )}
      </div>

      {principals.map((principal, pIdx) => {
        const principalLabel = pIdx === 0 ? 'Primary' : `Alternate ${pIdx}`
        const ca = coagentFor(principal.priority)
        const canAddCoAgent = !ca

        return (
          <div key={principal.priority} className="space-y-2">
            {/* Principal row */}
            <div className="relative rounded-lg border border-gray-200 bg-gray-50 p-4">
              <ContactPickerField
                intakeId={intakeId}
                value={principal}
                onChange={(updated) => updateEntry(indexInEntries(principal), updated)}
                label={principalLabel}
                onRemove={pIdx > 0 ? () => removeEntry(principal) : undefined}
                localContacts={allLocalContacts}
                FormField={FormField}
                Row2={Row2}
                TextInput={TextInput}
                PhoneInput={PhoneInput}
                SelectInput={SelectInput}
                ContactAddressFields={ContactAddressFields}
                suffixOptions={INTAKE_SUFFIX_SELECT_OPTIONS}
              />
            </div>

            {/* Co-agent row (indented) — not shown for HCP */}
            {allowCoAgent && ca && (
              <div className="relative ml-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <ContactPickerField
                  intakeId={intakeId}
                  value={ca}
                  onChange={(updated) => updateEntry(indexInEntries(ca), updated)}
                  label="Co-Agent"
                  onRemove={() => removeEntry(ca)}
                  localContacts={allLocalContacts}
                  FormField={FormField}
                  Row2={Row2}
                  TextInput={TextInput}
                  PhoneInput={PhoneInput}
                  SelectInput={SelectInput}
                  ContactAddressFields={ContactAddressFields}
                  suffixOptions={INTAKE_SUFFIX_SELECT_OPTIONS}
                />
              </div>
            )}

            {/* Add Co-Agent button (indented) — not shown for HCP */}
            {allowCoAgent && canAddCoAgent && (
              <div className="ml-6">
                <AddButton onClick={() => addCoAgentFor(principal.priority)} label="Add co-agent" />
              </div>
            )}
          </div>
        )
      })}

      {canAddAlternate && (
        <AddButton onClick={addAlternate} label="Add alternate" />
      )}
    </div>
  )
}

export interface ChildEntry {
  id?: string
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  date_of_birth: string
  pronouns: string
  email: string
  phone: string
  same_address: boolean
  parent: string
  relationship?: string
  [key: string]: unknown
}

export interface AdditionalContactEntry {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  email: string
  phone: string
  relationship: string
  street: string
  city: string
  state: string
  zip: string
  /** Composed mailing line (denormalised for fiduciary JSON blobs). */
  address: string
  [key: string]: unknown
}

export interface StepDef {
  id: string
  title: string
  subtitle: string
  timeEstimate: number // minutes
  condition?: (data: Record<string, unknown>) => boolean
}

// ─── Step Props ────────────────────────────────────────────────
export interface StepProps {
  data: Record<string, unknown>
  update: (field: string, value: unknown) => void
  intakeId?: string
  publicIntakeToken?: string
}

// ─── Step Definitions ──────────────────────────────────────────
export const ALL_STEPS: StepDef[] = [
  { id: 'referral', title: 'Getting Started', subtitle: 'How did you find us?', timeEstimate: 1 },
  { id: 'personal', title: 'Personal Information', subtitle: 'Name, contact & address', timeEstimate: 5 },
  { id: 'family', title: 'Family', subtitle: 'Marital status & dependents', timeEstimate: 2 },
  { id: 'spouse', title: 'Spouse Information', subtitle: "Spouse's details", timeEstimate: 3, condition: (d) => d.marital_status === 'married' },
  { id: 'children', title: 'Children', subtitle: "Children's information", timeEstimate: 3, condition: (d) => d.has_children === true },
  { id: 'estate', title: 'Financial', subtitle: 'Assets & financial overview', timeEstimate: 5 },
  { id: 'goals', title: 'Goals & Wishes', subtitle: 'Priorities & special wishes', timeEstimate: 4 },
  {
    id: 'additional_contacts',
    title: 'Additional Contacts',
    subtitle: 'Other people you may name as fiduciaries (optional)',
    timeEstimate: 3,
  },
  { id: 'fiduciaries', title: 'Your Fiduciaries', subtitle: 'Trustees, agents & proxies', timeEstimate: 7 },
  { id: 'spouse_fiduciaries', title: "Spouse's Fiduciaries", subtitle: "Spouse's trustees & agents", timeEstimate: 5, condition: (d) => d.marital_status === 'married' },
  { id: 'guardian', title: 'Guardian for Minors', subtitle: 'Care for minor children', timeEstimate: 2, condition: (d) => d.has_minor_children === true },
  { id: 'review', title: 'Review & Submit', subtitle: 'Confirm & submit', timeEstimate: 2 },
]

// Step segment groupings (kept for reference)
// ─── Step Components ───────────────────────────────────────────

const REFERRAL_SOURCES = REFERRAL_SOURCE_OPTIONS.map((o) => o.value)
const LEGAL_INSURANCE_PLANS = LEGAL_INSURANCE_PLAN_OPTIONS.map((o) => o.value)

export function StepReferral({ data, update }: StepProps) {
  const source = data.referral_source as string | undefined
  return (
    <div className="space-y-6">
      <FormField label="How did you hear about us?" optional>
        <div className="flex flex-wrap gap-2">
          {REFERRAL_SOURCES.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                update('referral_source', opt)
                // clear sub-fields when switching
                if (opt !== 'Legal Insurance') {
                  update('legal_insurance_plan', '')
                  update('legal_insurance_member_id', '')
                }
                if (opt !== 'Referral') {
                  update('referral_name', '')
                }
              }}
              aria-pressed={source === opt}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                source === opt
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </FormField>

      {source === 'Legal Insurance' && (
        <>
          <FormField label="Legal Insurance Plan">
            <div className="flex flex-wrap gap-2">
              {LEGAL_INSURANCE_PLANS.map((plan) => (
                <button
                  key={plan}
                  type="button"
                  onClick={() => update('legal_insurance_plan', plan)}
                  aria-pressed={data.legal_insurance_plan === plan}
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                    data.legal_insurance_plan === plan
                      ? 'border-accent bg-accent text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                  )}
                >
                  {plan}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Member ID / Case Number">
            <TextInput
              value={data.legal_insurance_member_id as string ?? ''}
              onChange={(v) => update('legal_insurance_member_id', v)}
              placeholder="Enter your member ID or case number"
            />
          </FormField>
        </>
      )}

      {source === 'Referral' && (
        <FormField label="Who referred you? We'd love to thank them!">
          <TextInput
            value={data.referral_name as string ?? ''}
            onChange={(v) => update('referral_name', v)}
            placeholder="Name of the person who referred you"
          />
        </FormField>
      )}
    </div>
  )
}

export function StepPersonal({ data, update }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="First Name">
          <TextInput value={data.first_name as string} onChange={(v) => update('first_name', v)} required />
        </FormField>
        <FormField label="Middle Name">
          <TextInput value={data.middle_name as string ?? ''} onChange={(v) => update('middle_name', v)} />
        </FormField>
        <FormField label="Last Name">
          <TextInput value={data.last_name as string} onChange={(v) => update('last_name', v)} required />
        </FormField>
        <FormField label="Suffix">
          <SelectInput
            value={data.suffix as string ?? ''}
            onChange={(v) => update('suffix', v)}
            placeholder="—"
            options={SUFFIXES.map((s) => ({ value: s, label: s }))}
          />
        </FormField>
      </div>
      <Row2>
        <FormField label="Prior Name (maiden/former)">
          <TextInput value={data.prior_name as string ?? ''} onChange={(v) => update('prior_name', v)} />
        </FormField>
        <FormField label="Preferred Name">
          <TextInput value={data.preferred_name as string ?? ''} onChange={(v) => update('preferred_name', v)} />
        </FormField>
      </Row2>
      <Row2>
        <FormField label="Date of Birth">
          <TextInput value={data.date_of_birth as string} onChange={(v) => update('date_of_birth', v)} type="date" />
        </FormField>
        <FormField label="Pronouns">
          <IntakeField
            fieldId="client_pronouns"
            value={data.preferred_pronoun}
            onChange={(v) => update('preferred_pronoun', v)}
            placeholder="Select pronouns"
          />
        </FormField>
      </Row2>
      <ToggleSwitch
        checked={data.is_us_citizen as boolean ?? true}
        onChange={(v) => update('is_us_citizen', v)}
        label="U.S. Citizen"
      />
      <SectionDivider title="Contact Information" />
      <Row2>
        <FormField label="Email">
          <TextInput value={data.email as string} onChange={(v) => update('email', v)} type="email" />
        </FormField>
        <FormField label="Phone">
          <PhoneInput value={data.phone as string} onChange={(v) => update('phone', v)} />
        </FormField>
      </Row2>
      <SectionDivider title="Address" />
      <ContactAddressFields
        street={data.street_address as string ?? ''}
        city={data.city as string ?? ''}
        state={data.state as string ?? 'MA'}
        zip={data.zip as string ?? ''}
        county={data.county as string ?? ''}
        onStreetChange={(v) => update('street_address', v)}
        onCityChange={(v) => update('city', v)}
        onStateChange={(v) => update('state', v)}
        onZipChange={(v) => update('zip', v)}
        onCountyChange={(v) => update('county', v)}
        onAddressSelect={(addr) => {
          update('street_address', addr.street)
          update('city', addr.city)
          update('state', addr.state || 'MA')
          update('zip', addr.zip)
          if (addr.county) update('county', addr.county)
        }}
      />
      <p className="text-xs text-gray-400">Search to auto-fill, or enter manually below.</p>
    </div>
  )
}

export function StepFamily({ data, update }: StepProps) {
  return (
    <div className="space-y-6">
      <FormField label="Marital Status">
        <IntakeField
          fieldId="marital_status"
          value={data.marital_status}
          onChange={(v) => update('marital_status', v)}
          variant="pills"
        />
      </FormField>

      <FormField label="Do you have children?">
        <div className="flex flex-wrap gap-2">
          {[
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => {
                update('has_children', opt.value)
                if (!opt.value) update('has_minor_children', false)
              }}
              aria-pressed={data.has_children === opt.value}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                data.has_children === opt.value
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FormField>

      {Boolean(data.has_children) && (
        <FormField label="Do you have children under 18?">
          <div className="flex flex-wrap gap-2">
            {[
              { value: true, label: 'Yes' },
              { value: false, label: 'No' },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => update('has_minor_children', opt.value)}
                aria-pressed={data.has_minor_children === opt.value}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                  data.has_minor_children === opt.value
                    ? 'border-accent bg-accent text-white'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FormField>
      )}

      <InfoBox>
        The information you share here helps us understand your family situation so we can prepare
        the right documents. If you are married, we&apos;ll ask about your spouse next.
        If you have children, we&apos;ll collect their details in a following step.
      </InfoBox>
    </div>
  )
}

export function StepSpouse({ data, update }: StepProps) {
  const spouse = (data._spouse as Record<string, string>) ?? {}
  function updateSpouse(field: string, value: string | boolean) {
    update('_spouse', { ...spouse, [field]: value })
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="First Name">
          <TextInput value={spouse.first_name ?? ''} onChange={(v) => updateSpouse('first_name', v)} required />
        </FormField>
        <FormField label="Middle Name">
          <TextInput value={spouse.middle_name ?? ''} onChange={(v) => updateSpouse('middle_name', v)} />
        </FormField>
        <FormField label="Last Name">
          <TextInput value={spouse.last_name ?? ''} onChange={(v) => updateSpouse('last_name', v)} required />
        </FormField>
        <FormField label="Suffix">
          <SelectInput
            value={spouse.suffix ?? ''}
            onChange={(v) => updateSpouse('suffix', v)}
            placeholder="—"
            options={SUFFIXES.map((s) => ({ value: s, label: s }))}
          />
        </FormField>
      </div>
      <Row2>
        <FormField label="Prior Name (maiden/former)">
          <TextInput value={spouse.prior_name ?? ''} onChange={(v) => updateSpouse('prior_name', v)} />
        </FormField>
        <FormField label="Preferred Name">
          <TextInput value={spouse.preferred_name ?? ''} onChange={(v) => updateSpouse('preferred_name', v)} />
        </FormField>
      </Row2>
      <Row2>
        <FormField label="Date of Marriage">
          <TextInput
            value={(data.date_of_marriage as string) ?? ''}
            onChange={(v) => update('date_of_marriage', v)}
            type="date"
          />
        </FormField>
        <FormField label="Date of Birth">
          <TextInput value={spouse.date_of_birth ?? ''} onChange={(v) => updateSpouse('date_of_birth', v)} type="date" />
        </FormField>
      </Row2>
      <Row2>
        <FormField label="Pronouns">
          <IntakeField
            fieldId="spouse_pronouns"
            value={spouse.preferred_pronoun}
            onChange={(v) => updateSpouse('preferred_pronoun', String(v ?? ''))}
            placeholder="Select pronouns"
          />
        </FormField>
        <div />
      </Row2>
      <ToggleSwitch
        checked={(spouse.is_us_citizen as unknown as boolean) ?? true}
        onChange={(v) => update('_spouse', { ...spouse, is_us_citizen: v })}
        label="U.S. Citizen"
      />
      <SectionDivider title="Contact" />
      <Row2>
        <FormField label="Email">
          <TextInput value={spouse.email ?? ''} onChange={(v) => updateSpouse('email', v)} type="email" />
        </FormField>
        <FormField label="Phone">
          <PhoneInput value={spouse.phone ?? ''} onChange={(v) => updateSpouse('phone', v)} />
        </FormField>
      </Row2>
    </div>
  )
}

export function StepChildren({ data, update }: StepProps) {
  const children = ((data._children as ChildEntry[]) ?? [])

  const clientFirstName = (data.first_name as string) || 'Client'
  const spouse = data._spouse as Record<string, string> | undefined
  const spouseFirstName = spouse?.first_name || ''
  const isMarried = data.marital_status === 'married'

  function updateChildren(updated: ChildEntry[]) {
    update('_children', updated)
  }

  function addChild() {
    updateChildren([...children, {
      id: crypto.randomUUID(),
      first_name: '',
      middle_name: '',
      last_name: '',
      suffix: '',
      date_of_birth: '',
      pronouns: '',
      email: '',
      phone: '',
      same_address: false,
      parent: 'both',
      relationship: 'biological',
    }])
  }

  function removeChild(index: number) {
    updateChildren(children.filter((_, i) => i !== index))
  }

  function updateChild(index: number, field: string, value: unknown) {
    const updated = [...children]
    updated[index] = { ...updated[index], [field]: value }
    updateChildren(updated)
  }

  return (
    <div className="space-y-4">
      {children.map((child, idx) => (
        <div key={child.id ?? idx} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">Child {idx + 1}</span>
            <button type="button" onClick={() => removeChild(idx)} aria-label={`Remove child ${idx + 1}`} className="text-red-500 hover:text-red-700">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="First Name">
                <TextInput value={child.first_name} onChange={(v) => updateChild(idx, 'first_name', v)} />
              </FormField>
              <FormField label="Middle Name">
                <TextInput value={child.middle_name ?? ''} onChange={(v) => updateChild(idx, 'middle_name', v)} />
              </FormField>
              <FormField label="Last Name">
                <TextInput value={child.last_name} onChange={(v) => updateChild(idx, 'last_name', v)} />
              </FormField>
              <FormField label="Suffix">
                <SelectInput
                  value={child.suffix ?? ''}
                  onChange={(v) => updateChild(idx, 'suffix', v)}
                  placeholder="—"
                  options={SUFFIXES.map((s) => ({ value: s, label: s }))}
                />
              </FormField>
            </div>
            <Row2>
              <FormField label="Date of Birth">
                <TextInput value={child.date_of_birth} onChange={(v) => updateChild(idx, 'date_of_birth', v)} type="date" />
              </FormField>
              <FormField label="Relationship">
                <SelectInput
                  value={child.relationship ?? 'biological'}
                  onChange={(v) => updateChild(idx, 'relationship', v)}
                  options={CHILD_RELATIONSHIP_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </FormField>
            </Row2>
            <Row2>
              <FormField label="Pronouns">
                <SelectInput
                  value={child.pronouns ?? ''}
                  onChange={(v) => updateChild(idx, 'pronouns', v)}
                  placeholder="Select pronouns"
                  options={PRONOUN_OPTIONS}
                />
              </FormField>
              <div />
            </Row2>
            <Row2>
              <FormField label="Email">
                <TextInput value={child.email ?? ''} onChange={(v) => updateChild(idx, 'email', v)} type="email" />
              </FormField>
              <FormField label="Phone">
                <PhoneInput value={child.phone ?? ''} onChange={(v) => updateChild(idx, 'phone', v)} />
              </FormField>
            </Row2>
            <ToggleSwitch
              checked={child.same_address ?? false}
              onChange={(v) => updateChild(idx, 'same_address', v)}
              label="Same address as client"
            />
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Parent</p>
              <div className="flex flex-wrap gap-2">
                {(['both', clientFirstName, ...(isMarried && spouseFirstName ? [spouseFirstName] : [])]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => updateChild(idx, 'parent', opt === 'both' ? 'both' : opt)}
                    aria-pressed={(child.parent ?? 'both') === (opt === 'both' ? 'both' : opt)}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition-colors',
                      (child.parent ?? 'both') === (opt === 'both' ? 'both' : opt)
                        ? 'border-accent bg-accent text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    )}
                  >
                    {opt === 'both' ? 'Both' : opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
      <AddButton onClick={addChild} label="Add child" />
    </div>
  )
}

// ─── Financial Asset Types & Helpers ──────────────────────────

interface RealEstateItem {
  id: string
  type: string
  address: string
  owner: string
  value: string
  mortgage: string
  notes: string
}

interface AssetTotals {
  client_total: string
  spouse_total: string
  joint_total: string
}

interface BusinessItem {
  id: string
  name: string
  business_type: string
  interest_pct: string
  value: string
  owner: string
}

interface LiabilityItem {
  id: string
  description: string
  value: string
  owner: string
}

const ASSET_LABELS = Object.fromEntries(
  INTAKE_ASSET_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<string, string>

const ASSET_TOTALS_KEYS = [...INTAKE_ASSET_TOTALS_KEYS]

function isAssetTotalsKey(key: string): key is IntakeAssetTotalsKey {
  return (ASSET_TOTALS_KEYS as readonly string[]).includes(key)
}

// Modal wrapper
function AssetModal({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close details" className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6">
          <p className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            These details are optional. Rough estimates are fine, and you can skip for now and add more at your appointment.
          </p>
          {children}
        </div>
        <div className="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-5 py-2 text-sm font-medium text-white"
            style={{ background: TEAL }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// Real Estate modal content
function RealEstateModalContent({ items, onChange }: {
  items: RealEstateItem[]
  onChange: (items: RealEstateItem[]) => void
}) {
  const propertyTypes = ['Residential', 'Commercial', 'Rental', 'Vacation Home', 'Land', 'Other']
  const ownerOptions = ['Client', 'Spouse', 'Joint']

  function addRow() {
    onChange([...items, { id: crypto.randomUUID(), type: '', address: '', owner: 'Client', value: '', mortgage: '', notes: '' }])
  }

  function updateRow(id: string, field: keyof RealEstateItem, val: string) {
    onChange(items.map(r => r.id === id ? { ...r, [field]: val } : r))
  }

  function removeRow(id: string) {
    onChange(items.filter(r => r.id !== id))
  }

  const inputCls = 'w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-gray-400">No properties added yet. Click &quot;Add Property&quot; below.</p>
      )}
      {items.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Property {idx + 1}</span>
            <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove property ${idx + 1}`} className="text-gray-400 hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
              <select value={row.type} onChange={e => updateRow(row.id, 'type', e.target.value)} className={inputCls}>
                <option value="">Select type</option>
                {propertyTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Owner</label>
              <select value={row.owner} onChange={e => updateRow(row.id, 'owner', e.target.value)} className={inputCls}>
                {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-500">Address</label>
              <input type="text" value={row.address} onChange={e => updateRow(row.id, 'address', e.target.value)} placeholder="123 Main St, Boston, MA 02101" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Estimated Value</label>
              <input type="text" value={row.value} onChange={e => updateRow(row.id, 'value', e.target.value)} placeholder="$500,000" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Mortgage Balance</label>
              <input type="text" value={row.mortgage} onChange={e => updateRow(row.id, 'mortgage', e.target.value)} placeholder="$200,000 (or None)" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-500">Notes</label>
              <textarea
                value={row.notes ?? ''}
                onChange={e => updateRow(row.id, 'notes', e.target.value)}
                rows={2}
                placeholder="Anything we should know about this property (e.g. held in trust, co-owned, rented)…"
                className={inputCls}
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" /> Add Property
      </button>
    </div>
  )
}

// Business interests modal — one structured row per business
function BusinessModalContent({ items, onChange }: {
  items: BusinessItem[]
  onChange: (items: BusinessItem[]) => void
}) {
  const businessTypes = ['Sole Proprietorship', 'LLC', 'Partnership', 'Corporation', 'Other']
  const ownerOptions = ['Client', 'Spouse', 'Joint']
  const inputCls = 'w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

  function addRow() {
    onChange([...items, { id: crypto.randomUUID(), name: '', business_type: '', interest_pct: '', value: '', owner: 'Client' }])
  }
  function updateRow(id: string, field: keyof BusinessItem, val: string) {
    onChange(items.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function removeRow(id: string) {
    onChange(items.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-gray-400">No businesses added yet. Click &quot;Add Business&quot; below.</p>
      )}
      {items.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Business {idx + 1}</span>
            <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove business ${idx + 1}`} className="text-gray-400 hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-500">Name of Business</label>
              <input type="text" value={row.name} onChange={e => updateRow(row.id, 'name', e.target.value)} placeholder="Acme Holdings LLC" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
              <select value={row.business_type} onChange={e => updateRow(row.id, 'business_type', e.target.value)} className={inputCls}>
                <option value="">Select type</option>
                {businessTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Owner</label>
              <select value={row.owner} onChange={e => updateRow(row.id, 'owner', e.target.value)} className={inputCls}>
                {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Size of Interest (%)</label>
              <input type="text" value={row.interest_pct} onChange={e => updateRow(row.id, 'interest_pct', e.target.value)} placeholder="100%" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Estimated Value</label>
              <input type="text" value={row.value} onChange={e => updateRow(row.id, 'value', e.target.value)} placeholder="$250,000" className={inputCls} />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" /> Add Business
      </button>
    </div>
  )
}

// Liabilities modal — one row per debt the client owes
function LiabilityModalContent({ items, onChange }: {
  items: LiabilityItem[]
  onChange: (items: LiabilityItem[]) => void
}) {
  const ownerOptions = ['Client', 'Spouse', 'Joint']
  const inputCls = 'w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

  function addRow() {
    onChange([...items, { id: crypto.randomUUID(), description: '', value: '', owner: 'Client' }])
  }
  function updateRow(id: string, field: keyof LiabilityItem, val: string) {
    onChange(items.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function removeRow(id: string) {
    onChange(items.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-gray-400">No liabilities added yet. Click &quot;Add Liability&quot; below.</p>
      )}
      {items.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-gray-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Liability {idx + 1}</span>
            <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove liability ${idx + 1}`} className="text-gray-400 hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
              <input type="text" value={row.description} onChange={e => updateRow(row.id, 'description', e.target.value)} placeholder="Mortgage, auto loan, credit card…" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Amount Owed</label>
              <input type="text" value={row.value} onChange={e => updateRow(row.id, 'value', e.target.value)} placeholder="$25,000" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Owner</label>
              <select value={row.owner} onChange={e => updateRow(row.id, 'owner', e.target.value)} className={inputCls}>
                {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" /> Add Liability
      </button>
    </div>
  )
}

// Totals modal (bank, investment, retirement, life insurance, custodial, crypto)
function AssetTotalsContent({ label, totals, onChange, clientName, spouseName }: {
  label: string
  totals: AssetTotals
  onChange: (t: AssetTotals) => void
  clientName?: string
  spouseName?: string
}) {
  const inputCls = 'w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
  const rows: { field: keyof AssetTotals; label: string }[] = [
    { field: 'client_total', label: clientName ? `${clientName}'s Total` : 'Client Total' },
    { field: 'spouse_total', label: spouseName ? `${spouseName}'s Total` : 'Spouse Total' },
    { field: 'joint_total', label: 'Joint Total' },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">Enter approximate totals for all {label.toLowerCase()} combined.</p>
      {rows.map(({ field, label: rowLabel }) => (
        <div key={field}>
          <label className="mb-1 block text-sm font-medium text-gray-700">{rowLabel}</label>
          <input
            type="text"
            value={totals[field]}
            onChange={e => onChange({ ...totals, [field]: e.target.value })}
            placeholder="$0 or leave blank"
            className={inputCls}
          />
        </div>
      ))}
    </div>
  )
}

// Text area modal (personal property, other assets)
function AssetTextContent({ label, value, onChange }: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">Describe your {label.toLowerCase()} — include approximate values if known.</p>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={6}
        placeholder={`Describe your ${label.toLowerCase()}…`}
        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}

// Summary line shown below a checked asset
function AssetSummary({ assetKey, data, clientName, spouseName }: {
  assetKey: string
  data: Record<string, unknown>
  clientName?: string
  spouseName?: string
}) {
  if (assetKey === 'real_estate') {
    const items = (data.financial_real_estate as RealEstateItem[]) ?? []
    if (!items.length) return null
    return <p className="mt-1 text-xs text-accent">{items.length} {items.length === 1 ? 'property' : 'properties'} added</p>
  }
  if (assetKey === 'business_interests') {
    const items = (data.financial_business_interests as BusinessItem[]) ?? []
    if (!Array.isArray(items) || !items.length) return null
    return <p className="mt-1 text-xs text-accent">{items.length} {items.length === 1 ? 'business' : 'businesses'} added</p>
  }
  if (assetKey === 'liabilities') {
    const items = (data.financial_liabilities as LiabilityItem[]) ?? []
    if (!Array.isArray(items) || !items.length) return null
    return <p className="mt-1 text-xs text-accent">{items.length} {items.length === 1 ? 'liability' : 'liabilities'} added</p>
  }
  if (isAssetTotalsKey(assetKey)) {
    const key = `financial_${assetKey}` as keyof typeof data
    const t = data[key] as AssetTotals | undefined
    if (!t) return null
    const parts = [
      t.client_total && `${clientName ?? 'Client'}: ${t.client_total}`,
      t.spouse_total && `${spouseName ?? 'Spouse'}: ${t.spouse_total}`,
      t.joint_total && `Joint: ${t.joint_total}`,
    ].filter(Boolean)
    if (!parts.length) return null
    return <p className="mt-1 text-xs text-accent">{parts.join(' · ')}</p>
  }
  if (['personal_property', 'other_assets'].includes(assetKey)) {
    const key = `financial_${assetKey}` as keyof typeof data
    const val = data[key] as string | undefined
    if (!val?.trim()) return null
    return <p className="mt-1 text-xs text-accent line-clamp-1">{val.slice(0, 60)}{val.length > 60 ? '…' : ''}</p>
  }
  return null
}

// ─── StepEstate ────────────────────────────────────────────────

export function StepEstate({ data, update }: StepProps) {
  const [activeModal, setActiveModal] = useState<string | null>(null)

  // Use entered first names for personalized labels; fall back to generic
  const clientName = (data.first_name as string | undefined)?.trim() || undefined
  const spouseName = ((data._spouse as Record<string, string> | undefined)?.first_name ?? (data.spouse_first_name as string | undefined))?.trim() || undefined

  const currentAssets = (data.asset_types as string[]) ?? []
  function toggleAsset(asset: string) {
    const updated = currentAssets.includes(asset)
      ? currentAssets.filter((a) => a !== asset)
      : [...currentAssets, asset]
    update('asset_types', updated)
  }

  // Free-text detail captured when a special-circumstance toggle is on. Stored
  // under the financial_ prefix so it lands in the financial_details JSONB.
  const circumstanceDetails = (data.financial_circumstance_details as Record<string, string>) ?? {}
  function updateCircumstanceDetail(key: string, val: string) {
    update('financial_circumstance_details', { ...circumstanceDetails, [key]: val })
  }

  // Helpers for getting/setting financial detail data
  function getRealEstate(): RealEstateItem[] {
    return (data.financial_real_estate as RealEstateItem[]) ?? []
  }
  function getTotals(key: string): AssetTotals {
    return (data[`financial_${key}`] as AssetTotals) ?? { client_total: '', spouse_total: '', joint_total: '' }
  }
  function getText(key: string): string {
    return (data[`financial_${key}`] as string) ?? ''
  }
  function getBusinesses(): BusinessItem[] {
    const v = data.financial_business_interests
    return Array.isArray(v) ? (v as BusinessItem[]) : []
  }
  function getLiabilities(): LiabilityItem[] {
    const v = data.financial_liabilities
    return Array.isArray(v) ? (v as LiabilityItem[]) : []
  }

  // Modal content
  function renderModalContent(assetKey: string) {
    if (assetKey === 'real_estate') {
      return (
        <RealEstateModalContent
          items={getRealEstate()}
          onChange={(items) => update('financial_real_estate', items)}
        />
      )
    }
    if (assetKey === 'business_interests') {
      return (
        <BusinessModalContent
          items={getBusinesses()}
          onChange={(items) => update('financial_business_interests', items)}
        />
      )
    }
    if (assetKey === 'liabilities') {
      return (
        <LiabilityModalContent
          items={getLiabilities()}
          onChange={(items) => update('financial_liabilities', items)}
        />
      )
    }
    if (isAssetTotalsKey(assetKey)) {
      return (
        <AssetTotalsContent
          label={ASSET_LABELS[assetKey]}
          totals={getTotals(assetKey)}
          onChange={(t) => update(`financial_${assetKey}`, t)}
          clientName={clientName}
          spouseName={spouseName}
        />
      )
    }
    if (['personal_property', 'other_assets'].includes(assetKey)) {
      return (
        <AssetTextContent
          label={ASSET_LABELS[assetKey]}
          value={getText(assetKey)}
          onChange={(v) => update(`financial_${assetKey}`, v)}
        />
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      <FormField label="Estimated Total Estate Value">
        <IntakeField
          fieldId="estate_value"
          value={data.estate_value}
          onChange={(v) => update('estate_value', v)}
          placeholder="Select a range"
        />
      </FormField>

      <FormField label="What types of assets do you own?">
        <p className="mb-2 text-xs text-gray-500">
          Check everything that applies. Tap &quot;Add details&quot; only if you want to share more now — it is optional.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {INTAKE_ASSET_TYPE_VALUES.map((asset) => {
            const isChecked = currentAssets.includes(asset)
            return (
              <div key={asset} className={cn('rounded-md border p-3 transition-colors', isChecked ? 'border-accent bg-teal-bg' : 'border-gray-200 hover:bg-gray-50')}>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 flex-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleAsset(asset)}
                      className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
                    />
                    <span className="text-sm text-gray-700">{assetTypeLabel(asset)}</span>
                  </label>
                  {isChecked && (
                    <button
                      type="button"
                      onClick={() => setActiveModal(asset)}
                      className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent hover:text-white transition-colors border border-accent"
                    >
                      Add details
                    </button>
                  )}
                </div>
                {isChecked && <AssetSummary assetKey={asset} data={data} clientName={clientName} spouseName={spouseName} />}
              </div>
            )
          })}
        </div>
      </FormField>

      <SectionDivider title="Special Circumstances" />
      <div className="space-y-3">
        {SPECIAL_CIRCUMSTANCE_OPTIONS.map((c) => {
          const on = (data[c.value] as boolean) ?? false
          return (
            <div key={c.value}>
              <ToggleSwitch
                checked={on}
                onChange={(v) => update(c.value, v)}
                label={c.label}
              />
              {on && (
                <textarea
                  value={circumstanceDetails[c.value] ?? ''}
                  onChange={(e) => updateCircumstanceDetail(c.value, e.target.value)}
                  rows={2}
                  placeholder="Please provide additional information…"
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Asset detail modals */}
      {activeModal && (
        <AssetModal
          open={true}
          onClose={() => setActiveModal(null)}
          title={`${ASSET_LABELS[activeModal]} — Details`}
        >
          {renderModalContent(activeModal)}
        </AssetModal>
      )}
    </div>
  )
}

export function StepGoals({ data, update, intakeId, publicIntakeToken }: StepProps) {
  const currentGoals = (data.planning_goals as string[]) ?? (data.goals as string[]) ?? []
  function toggleGoal(goal: string) {
    const updated = currentGoals.includes(goal)
      ? currentGoals.filter((g) => g !== goal)
      : [...currentGoals, goal]
    update('planning_goals', updated)
  }

  const obj = (data.planning_objectives as Record<string, string>) ?? {}
  function updateObj(field: string, val: string) {
    update('planning_objectives', { ...obj, [field]: val })
  }

  return (
    <div className="space-y-6">
      <FormField label="Why did you choose Aubrey Law?" optional>
        <textarea
          value={obj.why_choose_firm ?? ''}
          onChange={(e) => updateObj('why_choose_firm', e.target.value)}
          rows={3}
          placeholder="A referral, online search, prior experience…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <WhyWeAsk>
          This helps us understand what mattered to you when choosing counsel and tailor your first conversation.
        </WhyWeAsk>
      </FormField>

      <FormField label="Why are you planning now?" optional>
        <textarea
          value={obj.why_now ?? ''}
          onChange={(e) => updateObj('why_now', e.target.value)}
          rows={3}
          placeholder="A life event, peace of mind, a nudge from family…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <WhyWeAsk>
          Your timing and motivation help your attorney focus the plan on what is driving you right now.
        </WhyWeAsk>
      </FormField>

      <FormField label="Is making things easy for loved ones important to you?" optional>
        <textarea
          value={obj.make_things_easy ?? ''}
          onChange={(e) => updateObj('make_things_easy', e.target.value)}
          rows={2}
          placeholder="Most clients say yes — share anything specific you have in mind."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <WhyWeAsk>
          Many clients want to spare family from confusion, conflict, or extra court steps. Your answer shapes how we structure the plan.
        </WhyWeAsk>
      </FormField>

      <FormField label="What are your estate planning goals?">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLANNING_GOAL_OPTIONS.map((goal) => {
            const selected = currentGoals.includes(goal.value)
            return (
              <button
                key={goal.value}
                type="button"
                onClick={() => toggleGoal(goal.value)}
                aria-pressed={selected}
                className={cn(
                  'rounded-lg border p-4 text-left transition-colors',
                  selected
                    ? 'border-accent bg-accent/5'
                    : 'border-gray-200 hover:border-gray-300'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                    selected ? 'border-accent bg-accent text-white' : 'border-gray-300'
                  )}>
                    {selected && <Check className="h-3 w-3" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{goal.label}</p>
                    <p className="text-xs text-gray-500">{goal.desc}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </FormField>

      <SectionDivider title="Additional Planning Information" />

      <FormField label="Do you have a will, trust, or other estate planning document?">
        <ToggleSwitch
          checked={(data.has_existing_plan as boolean) ?? false}
          onChange={(v) => update('has_existing_plan', v)}
          label={data.has_existing_plan ? 'Yes' : 'No'}
        />
        {!!data.has_existing_plan && intakeId && (
          <IntakeDocumentUpload
            intakeId={intakeId}
            kind="existing_plan"
            label="will, trust, or other estate planning documents"
            publicIntakeToken={publicIntakeToken}
          />
        )}
      </FormField>

      <FormField label="Are you making payments pursuant to a divorce or property settlement order?">
        <ToggleSwitch
          checked={(data.has_divorce_settlement as boolean) ?? false}
          onChange={(v) => update('has_divorce_settlement', v)}
          label={data.has_divorce_settlement ? 'Yes' : 'No'}
        />
        {!!data.has_divorce_settlement && intakeId && (
          <IntakeDocumentUpload
            intakeId={intakeId}
            kind="divorce_settlement"
            label="divorce or property settlement order"
            publicIntakeToken={publicIntakeToken}
          />
        )}
      </FormField>

      <FormField label="Do you own a long-term care (nursing home) insurance policy?">
        <ToggleSwitch
          checked={(data.has_ltc_insurance as boolean) ?? false}
          onChange={(v) => update('has_ltc_insurance', v)}
          label={data.has_ltc_insurance ? 'Yes' : 'No'}
        />
      </FormField>

      <FormField label="Have you ever filed federal or state gift tax returns?">
        <ToggleSwitch
          checked={(data.has_prior_gift_tax as boolean) ?? false}
          onChange={(v) => update('has_prior_gift_tax', v)}
          label={data.has_prior_gift_tax ? 'Yes' : 'No'}
        />
        {!!data.has_prior_gift_tax && intakeId && (
          <IntakeDocumentUpload
            intakeId={intakeId}
            kind="gift_tax_return"
            label="federal or state gift tax returns"
            publicIntakeToken={publicIntakeToken}
          />
        )}
      </FormField>

      <FormField label="Anything else you'd like us to know?">
        <textarea
          value={(data.special_notes as string) ?? ''}
          onChange={(e) => update('special_notes', e.target.value)}
          rows={4}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Any specific concerns, questions, or wishes you'd like to share..."
        />
      </FormField>
    </div>
  )
}

/** Optional nominees (saved to contacts with source `client_intake_additional`). */
export function StepAdditionalContacts({ data, update }: StepProps) {
  const nominees = ((data._additional_contacts as AdditionalContactEntry[]) ?? []).filter(Boolean)
  const suffixOptions = SUFFIXES.map((s) => ({ value: s, label: s }))

  function syncAddress(row: AdditionalContactEntry): AdditionalContactEntry {
    const composed =
      composedAddressOneLine({
        street: row.street,
        city: row.city,
        state: row.state,
        zip: row.zip,
      }) || ''
    return { ...row, address: composed }
  }

  function setNominees(next: AdditionalContactEntry[]) {
    update('_additional_contacts', next.map(syncAddress))
  }

  function addRow() {
    setNominees([
      ...nominees,
      syncAddress({
        id: crypto.randomUUID(),
        first_name: '',
        middle_name: '',
        last_name: '',
        suffix: '',
        email: '',
        phone: '',
        relationship: '',
        street: '',
        city: '',
        state: 'MA',
        zip: '',
        address: '',
      }),
    ])
  }

  function removeRow(index: number) {
    setNominees(nominees.filter((_, i) => i !== index))
  }

  function patchRow(index: number, patch: Partial<AdditionalContactEntry>) {
    const next = [...nominees]
    next[index] = syncAddress({ ...next[index], ...patch })
    setNominees(next)
  }

  return (
    <div className="space-y-4">
      <InfoBox>
        Add siblings, trusted friends, or professionals you might name under <strong>Fiduciaries</strong>{' '}
        (trustee, power of attorney, health care proxy, guardian, etc.). This step is optional — you only need people
        you already want the firm to have on file.
      </InfoBox>

      {nominees.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No additional contacts yet. Use &quot;Add contact&quot; if you&apos;d like to list anyone beyond your spouse
          and children.
        </p>
      )}

      {nominees.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Additional contact {idx + 1}</span>
            <button type="button" onClick={() => removeRow(idx)} aria-label={`Remove additional contact ${idx + 1}`} className="text-red-500 hover:text-red-700">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="First name">
                <TextInput value={row.first_name} onChange={(v) => patchRow(idx, { first_name: v })} />
              </FormField>
              <FormField label="Middle name">
                <TextInput value={row.middle_name ?? ''} onChange={(v) => patchRow(idx, { middle_name: v })} />
              </FormField>
              <FormField label="Last name">
                <TextInput value={row.last_name} onChange={(v) => patchRow(idx, { last_name: v })} />
              </FormField>
              <FormField label="Suffix">
                <SelectInput
                  value={row.suffix ?? ''}
                  onChange={(v) => patchRow(idx, { suffix: v })}
                  placeholder="—"
                  options={suffixOptions}
                />
              </FormField>
            </div>
            <Row2>
              <FormField label="Relationship to you">
                <TextInput
                  value={row.relationship}
                  onChange={(v) => patchRow(idx, { relationship: v })}
                  placeholder="e.g. Sister, Cousin, Financial advisor"
                />
              </FormField>
              <FormField label="Email">
                <TextInput value={row.email} onChange={(v) => patchRow(idx, { email: v })} type="email" />
              </FormField>
            </Row2>
            <Row2>
              <FormField label="Phone">
                <PhoneInput value={row.phone} onChange={(v) => patchRow(idx, { phone: v })} />
              </FormField>
            </Row2>
            <ContactAddressFields
              street={row.street ?? ''}
              city={row.city ?? ''}
              state={row.state ?? ''}
              zip={row.zip ?? ''}
              county=""
              onStreetChange={(v) => patchRow(idx, { street: v })}
              onCityChange={(v) => patchRow(idx, { city: v })}
              onStateChange={(v) => patchRow(idx, { state: v })}
              onZipChange={(v) => patchRow(idx, { zip: v })}
              onCountyChange={() => {}}
              onAddressSelect={(addr) =>
                patchRow(idx, {
                  street: addr.street,
                  city: addr.city,
                  state: addr.state || 'MA',
                  zip: addr.zip,
                })
              }
            />
          </div>
        </div>
      ))}

      <AddButton onClick={addRow} label="Add contact" />
    </div>
  )
}

const DEFAULT_FIDUCIARY_ENTRY: FiduciaryEntry = {
  first_name: '',
  middle_name: '',
  last_name: '',
  suffix: '',
  relationship: '',
  phone: '',
  email: '',
  address: '',
  street: '',
  city: '',
  state: '',
  zip: '',
  priority: 1,
}

function nomineeEntriesForPicker(data: Record<string, unknown>): FiduciaryEntry[] {
  const list = (data._additional_contacts as AdditionalContactEntry[]) ?? []
  return list
    .filter((n) => n.first_name?.trim() && n.last_name?.trim())
    .map((n) => ({
      ...DEFAULT_FIDUCIARY_ENTRY,
      first_name: n.first_name.trim(),
      middle_name: (n.middle_name ?? '').trim(),
      last_name: n.last_name.trim(),
      suffix: (n.suffix ?? '').trim(),
      relationship: (n.relationship?.trim() || 'Contact'),
      phone: formatPhoneInput(n.phone ?? ''),
      email: n.email ?? '',
      street: (n.street ?? '').trim(),
      city: (n.city ?? '').trim(),
      state: (n.state ?? '').trim() || 'MA',
      zip: (n.zip ?? '').trim(),
      address:
        composedAddressOneLine({
          street: n.street,
          city: n.city,
          state: n.state,
          zip: n.zip,
        }) ||
        (typeof n.address === 'string' ? n.address.trim() : '') ||
        '',
    }))
}

export function StepFiduciaries({ data, update, intakeId }: StepProps) {
  const id = intakeId ?? ''
  const clientName = (data.first_name as string | undefined)?.trim() || 'Your'
  const home = intakeResidentialAddress(data)

  // Synthetic entries for client and spouse so they appear in fiduciary search
  const clientEntry: FiduciaryEntry = { ...DEFAULT_FIDUCIARY_ENTRY,
    first_name: (data.first_name as string) || '',
    last_name:  (data.last_name as string) || '',
    email:      (data.email as string) || '',
    phone:      formatPhoneInput(data.phone as string),
    street: home.line,
    city: home.city,
    state: home.state || 'MA',
    zip: home.zip,
    address: home.composed,
    relationship: 'client',
  }
  const spouseFirstName = ((data._spouse as Record<string, string> | undefined)?.first_name ?? (data.spouse_first_name as string | undefined)) || ''
  const spouseLastName  = ((data._spouse as Record<string, string> | undefined)?.last_name  ?? (data.spouse_last_name  as string | undefined)) || ''
  const spouseEntry: FiduciaryEntry = { ...DEFAULT_FIDUCIARY_ENTRY,
    first_name: spouseFirstName,
    last_name:  spouseLastName,
    email:      ((data._spouse as Record<string, string> | undefined)?.email ?? (data.spouse_email as string | undefined)) || '',
    phone:      formatPhoneInput((data._spouse as Record<string, string> | undefined)?.phone ?? (data.spouse_phone as string | undefined)),
    street: home.line,
    city: home.city,
    state: home.state || 'MA',
    zip: home.zip,
    address: home.composed,
    relationship: 'spouse',
  }

  const trusteeEntries = (data._fid_trustee_client as FiduciaryEntry[])     ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const prEntries      = (data._fid_personal_rep_client as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const poaEntries     = (data._fid_poa_client as FiduciaryEntry[])           ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const hcpEntries     = (data._fid_hcp_client as FiduciaryEntry[])           ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]

  // Children as searchable entries
  const childEntries: FiduciaryEntry[] = ((data._children as ChildEntry[]) ?? [])
    .filter(c => c.first_name && c.last_name)
    .map((c) => {
      const base: FiduciaryEntry = {
        ...DEFAULT_FIDUCIARY_ENTRY,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email || '',
        phone: formatPhoneInput(c.phone || ''),
        relationship: 'child',
      }
      if (c.same_address) {
        return {
          ...base,
          street: home.line,
          city: home.city,
          state: home.state || 'MA',
          zip: home.zip,
          address: home.composed,
        }
      }
      return base
    })

  // Collect all contacts across all fiduciary arrays for cross-role search
  const allLocalContacts = [clientEntry, spouseEntry, ...childEntries, ...nomineeEntriesForPicker(data), ...prEntries, ...trusteeEntries, ...poaEntries, ...hcpEntries,
    ...((data._fid_personal_rep_spouse as FiduciaryEntry[]) ?? []),
    ...((data._fid_poa_spouse as FiduciaryEntry[]) ?? []),
    ...((data._fid_hcp_spouse as FiduciaryEntry[]) ?? []),
    ...((data._fid_guardian_client as FiduciaryEntry[]) ?? []),
  ].filter(e => e.first_name && e.last_name)

  return (
    <div className="space-y-8">

      {/* Intro */}
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Name the people who would step in to manage your trust, settle your estate, and make decisions if you cannot.
          Many clients choose a spouse, adult child, or trusted sibling — you can leave any role blank and discuss options with Aubrey Law.
        </p>
        <ExpandableHelp title="Learn more about these roles">
          <p>
            If your plan includes a Trust, you&apos;ll need to decide who manages and distributes your assets. The same person can serve in both roles, but each carries distinct responsibilities.
          </p>
          <p>
            <span className="font-medium text-gray-800">Successor Trustee:</span> Manages trust assets — property titled in the name of the Trust during your lifetime or made payable to the Trust at death. You will be the initial trustee of your own trust; the people you name here step in as successor trustees when you can no longer serve.
          </p>
          <p>
            <span className="font-medium text-gray-800">Personal Representative (Executor):</span> Settles your probate estate — generally any property titled solely in your name at death that lacks a designated beneficiary, a Transfer/Payable on Death instruction, or Rights of Survivorship.
          </p>
          <p className="font-medium text-gray-700">Which role does the heavy lifting?</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><span className="font-medium text-gray-800">Trust-Based Plan:</span> Both roles are necessary, but the Trustee typically carries more long-term responsibility, managing assets according to your Trust&apos;s instructions.</li>
            <li><span className="font-medium text-gray-800">Will-Based Plan:</span> There is no Trustee. The Personal Representative handles all administrative work to close the estate through probate.</li>
          </ul>
        </ExpandableHelp>
      </div>

      <InfoBox>
        If you are unsure who should serve in any role, you can leave it blank and discuss options with Aubrey Law.
      </InfoBox>

      <ReviewChoiceControl
        data={data}
        update={update}
        choiceKey="fiduciaries"
        label="If you are leaving any fiduciary roles blank, choose the reason so your attorney knows it is intentional."
      />

      <FiduciaryRole
        title={`${clientName === 'Your' ? 'Your' : `${clientName}'s`} Successor Trustee`}
        description={`Manages trust assets — property titled in the name of ${clientName === 'Your' ? 'your' : `${clientName}'s`} trust during ${clientName === 'Your' ? 'your' : 'their'} lifetime or made payable to the trust at death. ${clientName === 'Your' ? 'You' : clientName} will be the initial trustee of ${clientName === 'Your' ? 'your' : 'their'} trust.`}
        example="An adult child or trusted sibling who is organized and comfortable managing finances."
        entries={trusteeEntries}
        onChange={(entries) => update('_fid_trustee_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider />

      <FiduciaryRole
        title={`${clientName === 'Your' ? 'Your' : `${clientName}'s`} Personal Representative (Executor)`}
        description={`Settles ${clientName === 'Your' ? 'your' : `${clientName}'s`} probate estate — property titled solely in ${clientName === 'Your' ? 'your' : 'their'} name without a designated beneficiary or survivorship rights.`}
        example="A family member who can handle paperwork, court filings, and communicating with heirs."
        entries={prEntries}
        onChange={(entries) => update('_fid_personal_rep_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider />

      <FiduciaryRole
        title={`${clientName === 'Your' ? 'Your' : `${clientName}'s`} Financial Power of Attorney`}
        description={`Manages ${clientName === 'Your' ? 'your' : `${clientName}'s`} finances and legal matters if ${clientName === 'Your' ? 'you become' : 'they become'} incapacitated.`}
        example="Your spouse or adult child who would pay bills and manage accounts if you were hospitalized."
        entries={poaEntries}
        onChange={(entries) => update('_fid_poa_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider />

      <FiduciaryRole
        title={`${clientName === 'Your' ? 'Your' : `${clientName}'s`} Health Care Proxy`}
        description={`Makes medical decisions on ${clientName === 'Your' ? 'your' : `${clientName}'s`} behalf if ${clientName === 'Your' ? 'you' : 'they'} cannot.`}
        example="Someone who knows your wishes and would speak with doctors on your behalf."
        entries={hcpEntries}
        onChange={(entries) => update('_fid_hcp_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
        allowCoAgent={false}
      />

    </div>
  )
}

export function StepSpouseFiduciaries({ data, update, intakeId }: StepProps) {
  const id = intakeId ?? ''
  const spouseName = ((data._spouse as Record<string, string> | undefined)?.first_name ?? (data.spouse_first_name as string | undefined))?.trim() || undefined
  const sName = spouseName ?? 'Spouse'

  const home = intakeResidentialAddress(data)

  // Synthetic entries for client and spouse so they appear in fiduciary search
  const clientEntry: FiduciaryEntry = { ...DEFAULT_FIDUCIARY_ENTRY,
    first_name: (data.first_name as string) || '',
    last_name:  (data.last_name as string) || '',
    email:      (data.email as string) || '',
    phone:      formatPhoneInput(data.phone as string),
    street: home.line,
    city: home.city,
    state: home.state || 'MA',
    zip: home.zip,
    address: home.composed,
    relationship: 'client',
  }

  const poaEntries = (data._fid_poa_spouse as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const hcpEntries = (data._fid_hcp_spouse as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const prEntries  = (data._fid_personal_rep_spouse as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]

  const childEntries: FiduciaryEntry[] = ((data._children as ChildEntry[]) ?? [])
    .filter(c => c.first_name && c.last_name)
    .map((c) => {
      const base: FiduciaryEntry = {
        ...DEFAULT_FIDUCIARY_ENTRY,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email || '',
        phone: formatPhoneInput(c.phone || ''),
        relationship: 'child',
      }
      if (c.same_address) {
        return {
          ...base,
          street: home.line,
          city: home.city,
          state: home.state || 'MA',
          zip: home.zip,
          address: home.composed,
        }
      }
      return base
    })

  // The spouse is the principal for these roles, so they should not appear as a
  // choice for their own fiduciaries — but the client should.
  const allLocalContacts = [clientEntry, ...childEntries, ...nomineeEntriesForPicker(data), ...prEntries, ...poaEntries, ...hcpEntries,
    ...((data._fid_personal_rep_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_poa_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_hcp_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_trustee_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_guardian_client as FiduciaryEntry[]) ?? []),
  ].filter(e => e.first_name && e.last_name)

  return (
    <div className="space-y-8">
      <InfoBox>
        These are the people {spouseName ? spouseName : 'your spouse'} would like to serve as their fiduciaries. They may be the same as yours or different. If you are unsure, leave any role blank and discuss it with Aubrey Law.
      </InfoBox>

      <ReviewChoiceControl
        data={data}
        update={update}
        choiceKey="spouse_fiduciaries"
        label="If any spouse fiduciary roles are blank, choose the reason so your attorney knows it is intentional."
      />

      <FiduciaryRole
        title={`${sName}'s Personal Representative`}
        description={`Manages ${sName}'s probate estate.`}
        example="Often the same person who would serve as your personal representative, but it can be someone else."
        entries={prEntries}
        onChange={(entries) => update('_fid_personal_rep_spouse', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider />

      <FiduciaryRole
        title={`${sName}'s Financial Power of Attorney`}
        description={`Manages ${sName}'s finances and legal matters if they become incapacitated.`}
        example="Someone ${sName} trusts to pay bills and handle financial decisions."
        entries={poaEntries}
        onChange={(entries) => update('_fid_poa_spouse', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider />

      <FiduciaryRole
        title={`${sName}'s Health Care Proxy`}
        description={`Makes medical decisions on ${sName}'s behalf.`}
        example="Someone who knows ${sName}'s health care wishes and would advocate with doctors."
        entries={hcpEntries}
        onChange={(entries) => update('_fid_hcp_spouse', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
        allowCoAgent={false}
      />
    </div>
  )
}

export function StepGuardian({ data, update, intakeId }: StepProps) {
  const id = intakeId ?? ''
  const guardianEntries = (data._fid_guardian_client as FiduciaryEntry[]) ?? [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]
  const excludedEntries = (data._fid_excluded_guardian as FiduciaryEntry[]) ?? []
  const [hasExcluded, setHasExcluded] = useState(excludedEntries.length > 0)
  const clientName = (data.first_name as string | undefined)?.trim() || undefined
  const cName = clientName ?? 'Your'

  const home = intakeResidentialAddress(data)

  // Synthetic entries for client and spouse so they appear in fiduciary search
  const clientEntry: FiduciaryEntry = { ...DEFAULT_FIDUCIARY_ENTRY,
    first_name: (data.first_name as string) || '',
    last_name:  (data.last_name as string) || '',
    email:      (data.email as string) || '',
    phone:      formatPhoneInput(data.phone as string),
    street: home.line,
    city: home.city,
    state: home.state || 'MA',
    zip: home.zip,
    address: home.composed,
    relationship: 'client',
  }
  const spouseFirstName = ((data._spouse as Record<string, string> | undefined)?.first_name ?? (data.spouse_first_name as string | undefined)) || ''
  const spouseLastName  = ((data._spouse as Record<string, string> | undefined)?.last_name  ?? (data.spouse_last_name  as string | undefined)) || ''
  const spouseEntry: FiduciaryEntry = { ...DEFAULT_FIDUCIARY_ENTRY,
    first_name: spouseFirstName,
    last_name:  spouseLastName,
    email:      ((data._spouse as Record<string, string> | undefined)?.email ?? (data.spouse_email as string | undefined)) || '',
    phone:      formatPhoneInput((data._spouse as Record<string, string> | undefined)?.phone ?? (data.spouse_phone as string | undefined)),
    street: home.line,
    city: home.city,
    state: home.state || 'MA',
    zip: home.zip,
    address: home.composed,
    relationship: 'spouse',
  }

  const childEntries: FiduciaryEntry[] = ((data._children as ChildEntry[]) ?? [])
    .filter(c => c.first_name && c.last_name)
    .map((c) => {
      const base: FiduciaryEntry = {
        ...DEFAULT_FIDUCIARY_ENTRY,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email || '',
        phone: formatPhoneInput(c.phone || ''),
        relationship: 'child',
      }
      if (c.same_address) {
        return {
          ...base,
          street: home.line,
          city: home.city,
          state: home.state || 'MA',
          zip: home.zip,
          address: home.composed,
        }
      }
      return base
    })

  // A guardian steps in if the parents can't serve. For children who are the
  // joint children of both the client and spouse, neither parent is a guardian
  // candidate. But if either party has a separate child (a child of only one of
  // them), the other party is a legitimate guardian choice — so we only offer
  // the client and spouse as candidates when at least one separate child exists.
  const rawChildren = ((data._children as ChildEntry[]) ?? []).filter(c => c.first_name && c.last_name)
  const hasSeparateChild = rawChildren.some(c => typeof c.parent === 'string' && c.parent !== '' && c.parent !== 'both')
  const parentCandidates = hasSeparateChild ? [clientEntry, spouseEntry] : []

  const allLocalContacts = [...parentCandidates, ...childEntries, ...nomineeEntriesForPicker(data), ...guardianEntries,
    ...((data._fid_personal_rep_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_poa_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_hcp_client as FiduciaryEntry[]) ?? []),
    ...((data._fid_trustee_client as FiduciaryEntry[]) ?? []),
  ].filter(e => e.first_name && e.last_name)

  return (
    <div className="space-y-6">
      <InfoBox>
        If you know who you would want to serve as guardian for {clientName ? `${clientName}'s` : 'your'} minor children, add them here. If you are unsure, you can leave this blank and discuss it with Aubrey Law.
      </InfoBox>

      <ReviewChoiceControl
        data={data}
        update={update}
        choiceKey="guardian"
        label="If guardian information is blank, choose the reason so your attorney knows it is intentional."
      />

      <FiduciaryRole
        title={`${cName === 'Your' ? 'Your' : `${cName}'s`} Guardian for Minor Children`}
        description={`If ${cName === 'Your' ? 'you have' : `${cName} has`} children under 18, this person will raise them and be responsible for their care, custody, and control until they reach adulthood.`}
        example="A relative or close friend who shares your values and would raise your children if both parents could not."
        entries={guardianEntries}
        onChange={(entries) => update('_fid_guardian_client', entries)}
        intakeId={id}
        allLocalContacts={allLocalContacts}
      />

      <SectionDivider title="Excluded Persons" />

      <FormField label="Is there anyone you specifically do NOT want as guardian?">
        <ToggleSwitch
          checked={hasExcluded}
          onChange={(v) => {
            setHasExcluded(v)
            if (!v) update('_fid_excluded_guardian', [])
          }}
          label={hasExcluded ? 'Yes' : 'No'}
        />
      </FormField>

      {hasExcluded && (
        <FiduciaryRole
          title="Person(s) to exclude as guardian"
          description="Add anyone you specifically do not want to serve as guardian of your minor children."
          entries={excludedEntries.length ? excludedEntries : [{ ...DEFAULT_FIDUCIARY_ENTRY, priority: 1 }]}
          onChange={(entries) => update('_fid_excluded_guardian', entries)}
          intakeId={id}
          allLocalContacts={allLocalContacts}
          allowCoAgent={false}
        />
      )}
    </div>
  )
}

export function StepReview({
  data,
  intakeId,
  publicIntakeToken,
}: {
  data: Record<string, unknown>
  intakeId?: string
  publicIntakeToken?: string
}) {
  return (
    <IntakeQuestionnaireReview
      data={data}
      intakeId={intakeId}
      publicIntakeToken={publicIntakeToken}
    />
  )
}

// ─── Save Status Badge ─────────────────────────────────────────
export function SaveStatusBadge({ status }: { status: SaveStatus }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      {status === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>}
      {status === 'saved' && <><Save className="h-3.5 w-3.5 text-green-500" /> Saved</>}
      {status === 'error' && <><span className="h-2 w-2 rounded-full bg-red-500" /> Save error</>}
    </div>
  )
}

// ─── Main Wizard ───────────────────────────────────────────────
export default function IntakeWizard({
  initialData,
  intakeId,
  publicIntakeToken,
}: {
  initialData: Record<string, unknown>
  intakeId: string
  publicIntakeToken?: string
}) {
  const router = useRouter()
  const [data, setData] = useState<Record<string, unknown>>(() => {
    const base = { ...initialData }

    // Unpack financial_details JSONB → financial_* top-level keys
    const fd = base.financial_details as Record<string, unknown> | undefined
    if (fd && typeof fd === 'object') {
      for (const [k, v] of Object.entries(fd)) {
        base[`financial_${k}`] = v
      }
      delete base.financial_details
    }

    // F4a: review_choices is now a top-level column, not nested in
    // fiduciary_entries. Hydrate the overlay from there first.
    if (base.review_choices && typeof base.review_choices === 'object') {
      base._review_choices = base.review_choices
    }

    // Unpack fiduciary_entries JSONB → _fid_* keys + _children
    const fe = base.fiduciary_entries as Record<string, unknown> | undefined
    if (fe && typeof fe === 'object') {
      for (const [k, v] of Object.entries(fe)) {
        if (k === 'children') {
          base._children = v
        } else if (k === 'additional_contacts') {
          base._additional_contacts = v
        } else if (k === 'review_choices') {
          // Only hydrate from JSONB if the top-level column was empty
          // (handles legacy rows; new rows use the column).
          if (!base._review_choices) base._review_choices = v
        } else {
          base[`_${k}`] = v   // fid_poa_client → _fid_poa_client
        }
      }
      delete base.fiduciary_entries
    }

    // Build _spouse from individual spouse_* DB columns (if not already set)
    if (!base._spouse && (base.spouse_first_name || base.spouse_last_name)) {
      base._spouse = {
        first_name:        base.spouse_first_name        ?? '',
        last_name:         base.spouse_last_name         ?? '',
        middle_name:       base.spouse_middle_name       ?? '',
        suffix:            base.spouse_suffix            ?? '',
        prior_names:       base.spouse_prior_names       ?? '',
        preferred_name:    base.spouse_preferred_name    ?? '',
        preferred_pronoun: base.spouse_preferred_pronoun ?? '',
        date_of_birth:     base.spouse_date_of_birth     ?? '',
        is_us_citizen:     base.spouse_is_us_citizen     ?? true,
        phone:             formatPhoneInput(typeof base.spouse_phone === 'string' ? base.spouse_phone : ''),
        email:             base.spouse_email             ?? '',
      }
    }

    if (base.preferred_pronoun == null && base.pronouns != null) {
      base.preferred_pronoun = base.pronouns
    }

    return base
  })
  const [currentStepIndex, setCurrentStepIndex] = useState(() => {
    const saved = initialData.current_step as number
    return saved ? Math.max(0, saved - 1) : 0
  })
  const [submitting, setSubmitting] = useState(false)

  const { status: saveStatus, debouncedSave, saveNow } = useAutoSave(intakeId, 1500, publicIntakeToken)
  const { saveSpouse, saveChildren, saveFiduciaries, saveAdditionalContacts } = useContacts(intakeId)

  // Active steps based on current data conditions
  const activeSteps = useMemo(
    () => ALL_STEPS.filter((s) => !s.condition || s.condition(data)),
    [data]
  )

  const currentStep = activeSteps[currentStepIndex]

  const update = useCallback(
    (field: string, value: unknown) => {
      setData((prev) => {
        const next = { ...prev, [field]: value }
        debouncedSave(next)
        return next
      })
    },
    [debouncedSave]
  )

  // Save contacts and step on navigation
  async function persistContactsForStep(stepId: string) {
    if (stepId === 'spouse' && data._spouse) {
      await saveSpouse(data._spouse as Record<string, string>)
    }
    if (stepId === 'children' && data._children) {
      await saveChildren(data._children as ChildEntry[])
    }
    if (stepId === 'additional_contacts') {
      await saveAdditionalContacts(((data._additional_contacts as AdditionalContactEntry[]) ?? []))
    }
    const fiduciarySteps: Record<string, [string, 'client' | 'spouse'][]> = {
      fiduciaries: [
        ['trustee', 'client'],
        ['personal_rep', 'client'],
        ['poa', 'client'],
        ['hcp', 'client'],
      ],
      spouse_fiduciaries: [
        ['personal_rep', 'spouse'],
        ['poa', 'spouse'],
        ['hcp', 'spouse'],
      ],
      guardian: [['guardian', 'client']],
    }
    const roles = fiduciarySteps[stepId]
    if (roles) {
      for (const [role, party] of roles) {
        const key = `_fid_${role}_${party}`
        const entries = data[key] as FiduciaryEntry[] | undefined
        if (entries && entries.length > 0) {
          await saveFiduciaries(entries, role, party)
        }
      }
    }
  }

  // Persist contacts for every active step. Forward navigation already saves
  // each step on leave, but submit may happen after editing an earlier step
  // and jumping ahead — flush all active steps so nothing is left unsaved.
  // Iterating activeSteps (not every step) avoids persisting stale groups,
  // e.g. spouse fiduciaries when the client isn't married.
  async function persistAllContacts() {
    for (const step of activeSteps) {
      await persistContactsForStep(step.id)
    }
  }

  async function goToStep(index: number) {
    // Save current step data
    saveNow({ ...data, current_step: index + 1 })
    await persistContactsForStep(currentStep.id)
    setCurrentStepIndex(index)
  }

  async function handleNext() {
    if (currentStepIndex < activeSteps.length - 1) {
      await goToStep(currentStepIndex + 1)
    }
  }

  async function handlePrevious() {
    if (currentStepIndex > 0) {
      await goToStep(currentStepIndex - 1)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      // Save all pending contacts across every active step (not just the
      // current one) so edits to earlier fiduciary/contact steps can't be
      // dropped when submitting.
      await persistAllContacts()

      if (publicIntakeToken) {
        // Public token path — use the API route with X-Intake-Token header
        const res = await fetch('/api/intake', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Intake-Token': publicIntakeToken,
          },
          body: JSON.stringify({ existingId: intakeId, status: 'submitted' }),
        })
        if (!res.ok) {
          toast.error('Failed to submit questionnaire. Please try again.')
          setSubmitting(false)
          return
        }
      } else {
        // Authenticated session path — route through API for consistent matter creation
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          toast.error('Your session has expired. Please refresh and try again.')
          setSubmitting(false)
          return
        }
        const res = await fetch('/api/intake', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ existingId: intakeId, status: 'submitted' }),
        })
        if (!res.ok) {
          toast.error('Failed to submit questionnaire. Please try again.')
          setSubmitting(false)
          return
        }
      }

      router.refresh()
    } catch {
      toast.error('An unexpected error occurred.')
      setSubmitting(false)
    }
  }

  // Completed steps (any step before current is considered complete)
  const completedStepIds = new Set(activeSteps.slice(0, currentStepIndex).map((s) => s.id))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">

        {/* Step indicator */}
        <div className="mb-8">
          {/* Per-step progress bars */}
          <div className="mb-3 flex gap-1">
            {activeSteps.map((_, i) => (
              <div
                key={i}
                className="h-1 flex-1 rounded-full transition-all duration-200"
                style={{
                  background: i < currentStepIndex ? TEAL : i === currentStepIndex ? `${TEAL}99` : '#e5e7eb',
                }}
              />
            ))}
          </div>

          {/* Step label row */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-gray-400">
                Step {currentStepIndex + 1} of {activeSteps.length}
              </p>
              <h1 className="text-2xl font-bold" style={{ color: NAVY }}>
                {currentStep.title}
              </h1>
              {currentStep.subtitle && (
                <p className="mt-1 text-sm text-gray-500">{currentStep.subtitle}</p>
              )}
            </div>
            <div className="mt-1 shrink-0">
              <SaveStatusBadge status={saveStatus} />
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {currentStep.id === 'referral' && <StepReferral data={data} update={update} />}
          {currentStep.id === 'personal' && <StepPersonal data={data} update={update} />}
          {currentStep.id === 'family' && <StepFamily data={data} update={update} />}
          {currentStep.id === 'spouse' && <StepSpouse data={data} update={update} />}
          {currentStep.id === 'children' && <StepChildren data={data} update={update} />}
          {currentStep.id === 'estate' && <StepEstate data={data} update={update} />}
          {currentStep.id === 'goals' && <StepGoals data={data} update={update} />}
          {currentStep.id === 'additional_contacts' && <StepAdditionalContacts data={data} update={update} />}
          {currentStep.id === 'fiduciaries' && <StepFiduciaries data={data} update={update} intakeId={intakeId} />}
          {currentStep.id === 'spouse_fiduciaries' && <StepSpouseFiduciaries data={data} update={update} intakeId={intakeId} />}
          {currentStep.id === 'guardian' && <StepGuardian data={data} update={update} intakeId={intakeId} />}
          {currentStep.id === 'review' && (
            <StepReview data={data} intakeId={intakeId} publicIntakeToken={publicIntakeToken} />
          )}

          {/* Navigation */}
          <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-6">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={currentStepIndex === 0}
              className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>

            {currentStep.id === 'review' ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg px-6 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: NAVY }}
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                ) : (
                  'Submit Questionnaire'
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: TEAL }}
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Clickable step nav — visible on all sizes */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {activeSteps.map((step, idx) => {
            const isActive = idx === currentStepIndex
            const isCompleted = completedStepIds.has(step.id)
            const isClickable = isCompleted || isActive || idx === currentStepIndex + 1
            return (
              <button
                key={step.id}
                onClick={() => isClickable ? goToStep(idx) : undefined}
                disabled={!isClickable}
                title={step.title}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
                  isActive
                    ? 'text-white'
                    : isCompleted
                      ? 'text-white'
                      : isClickable
                        ? 'border border-gray-300 bg-white text-gray-500 hover:border-gray-400'
                        : 'cursor-default border border-gray-200 bg-white text-gray-300'
                )}
                style={isActive ? { backgroundColor: TEAL } : isCompleted ? { backgroundColor: TEAL, opacity: 0.75 } : {}}
              >
                {isCompleted && !isActive ? <Check className="h-3.5 w-3.5" /> : idx + 1}
              </button>
            )
          })}
        </div>

      </div>
    </div>
  )
}
