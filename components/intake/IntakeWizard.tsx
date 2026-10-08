'use client'

import {
  useId,
  useState,
  type ReactNode,
} from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { composedAddressOneLine, wizardStreetLine } from '@/lib/intakeContactAddress'
import { ContactPickerField } from '@/components/intake/FiduciaryContactPicker'
import { IntakeDocumentUpload, IntakeQuestionnaireReview } from '@/components/intake/IntakeQuestionnaireReviewContent'
import { getActiveSteps, getStepIssues } from '@/lib/intake/legacySections'
import { formatPhoneInput } from '@/lib/phone'
import { IntakeField } from '@/components/sharedFields/IntakeField'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  ContactAddressFields,
  AddButton,
  FormField,
  InfoBox,
  PhoneInput,
  Row2,
  SectionDivider,
  SelectInput,
  TextInput,
  ToggleSwitch,
} from '@/components/intake/IntakeFormPrimitives'
import type { ChildEntry } from '@/components/intake/IntakeChildrenStep'
import {
  INTAKE_ASSET_TOTALS_KEYS,
  INTAKE_ASSET_TYPE_OPTIONS,
  INTAKE_ASSET_TYPE_VALUES,
  PLANNING_GOAL_OPTIONS,
  PRONOUN_OPTIONS,
  SPECIAL_CIRCUMSTANCE_OPTIONS,
  SUFFIX_OPTIONS,
  assetTypeLabel,
  type IntakeAssetTotalsKey,
} from '@/lib/sharedFields'

export { StepReferral } from '@/components/intake/IntakeReferralStep'
export { StepPersonal } from '@/components/intake/IntakePersonalStep'
export { StepFamily, StepSpouse } from '@/components/intake/IntakeFamilySteps'
export { StepChildren, type ChildEntry } from '@/components/intake/IntakeChildrenStep'
// ─── Brand Colors ──────────────────────────────────────────────
const TEAL = '#1b6b72'

const SUFFIXES = SUFFIX_OPTIONS.map((o) => o.value)
const INTAKE_SUFFIX_SELECT_OPTIONS = SUFFIX_OPTIONS

/** Client mailing address segments for fiduciary “household contact” stubs. */
export function intakeResidentialAddress(data: Record<string, unknown>): {
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

function WhyWeAsk({ children }: { children: ReactNode }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-xs font-medium text-accent hover:underline">
        Why we ask
      </summary>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{children}</p>
    </details>
  )
}

export function ExpandableHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-muted px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-foreground">{title}</summary>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
    </details>
  )
}

export function ReviewChoiceControl({
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
    <div className="rounded-lg border border-amber-border bg-amber-bg p-4">
      <p className="text-sm font-medium text-amber">{label}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={current === 'discuss_with_attorney'}
          onClick={() => choose('discuss_with_attorney')}
          className={cn(
            'rounded-md border px-3 py-2 text-left text-sm transition-colors',
            current === 'discuss_with_attorney'
              ? 'border-amber-border bg-white text-amber'
              : 'border-amber-border bg-amber-bg text-amber hover:bg-white',
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
              ? 'border-amber-border bg-white text-amber'
              : 'border-amber-border bg-amber-bg text-amber hover:bg-white',
          )}
        >
          Not provided yet
        </button>
      </div>
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
  preferred_pronoun: string
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
export function FiduciaryRole({
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
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
        {example && (
          <p className="mt-2 rounded-md border border-border bg-white px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Example: </span>
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
            <div className="relative rounded-lg border border-border bg-muted p-4">
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
              <div className="relative ml-6 rounded-lg border border-border bg-muted p-4">
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

export interface AdditionalContactEntry {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  preferred_pronoun: string
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

// ─── Step Props ────────────────────────────────────────────────
export interface StepProps {
  data: Record<string, unknown>
  update: (field: string, value: unknown) => void
  intakeId?: string
  publicIntakeToken?: string
}

// ─── Step Components ───────────────────────────────────────────

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

export function AssetModal({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <div className="p-6">
          <DialogDescription className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-xs">
            These details are optional. Rough estimates are fine, and you can skip for now and add more at your appointment.
          </DialogDescription>
          {children}
        </div>
        <DialogFooter className="border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-5 py-2 text-sm font-medium text-white"
            style={{ background: TEAL }}
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  const inputCls = 'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/60 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]'

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No properties added yet. Click &quot;Add Property&quot; below.</p>
      )}
      {items.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Property {idx + 1}</span>
            <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove property ${idx + 1}`} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
              <select value={row.type} onChange={e => updateRow(row.id, 'type', e.target.value)} className={inputCls}>
                <option value="">Select type</option>
                {propertyTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Owner</label>
              <select value={row.owner} onChange={e => updateRow(row.id, 'owner', e.target.value)} className={inputCls}>
                {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Address</label>
              <input type="text" value={row.address} onChange={e => updateRow(row.id, 'address', e.target.value)} placeholder="123 Main St, Boston, MA 02101" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Estimated Value</label>
              <input type="text" value={row.value} onChange={e => updateRow(row.id, 'value', e.target.value)} placeholder="$500,000" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Mortgage Balance</label>
              <input type="text" value={row.mortgage} onChange={e => updateRow(row.id, 'mortgage', e.target.value)} placeholder="$200,000 (or None)" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea
                value={row.notes ?? ''}
                onChange={e => updateRow(row.id, 'notes', e.target.value)}
                rows={2}
                placeholder="Anything we should know about this property (e.g. held in trust, co-owned, rented)…"
                className="px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-accent hover:text-accent"
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
  const inputCls = 'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/60 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]'

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
        <p className="text-sm text-muted-foreground">No businesses added yet. Click &quot;Add Business&quot; below.</p>
      )}
      {items.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Business {idx + 1}</span>
            <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove business ${idx + 1}`} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Name of Business</label>
              <input type="text" value={row.name} onChange={e => updateRow(row.id, 'name', e.target.value)} placeholder="Acme Holdings LLC" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
              <select value={row.business_type} onChange={e => updateRow(row.id, 'business_type', e.target.value)} className={inputCls}>
                <option value="">Select type</option>
                {businessTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Owner</label>
              <select value={row.owner} onChange={e => updateRow(row.id, 'owner', e.target.value)} className={inputCls}>
                {ownerOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Size of Interest (%)</label>
              <input type="text" value={row.interest_pct} onChange={e => updateRow(row.id, 'interest_pct', e.target.value)} placeholder="100%" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Estimated Value</label>
              <input type="text" value={row.value} onChange={e => updateRow(row.id, 'value', e.target.value)} placeholder="$250,000" className={inputCls} />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-accent hover:text-accent"
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
  const inputCls = 'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/60 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]'

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
        <p className="text-sm text-muted-foreground">No liabilities added yet. Click &quot;Add Liability&quot; below.</p>
      )}
      {items.map((row, idx) => (
        <div key={row.id} className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Liability {idx + 1}</span>
            <button type="button" onClick={() => removeRow(row.id)} aria-label={`Remove liability ${idx + 1}`} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
              <input type="text" value={row.description} onChange={e => updateRow(row.id, 'description', e.target.value)} placeholder="Mortgage, auto loan, credit card…" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount Owed</label>
              <input type="text" value={row.value} onChange={e => updateRow(row.id, 'value', e.target.value)} placeholder="$25,000" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Owner</label>
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
        className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:border-accent hover:text-accent"
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
  const rows: { field: keyof AssetTotals; label: string }[] = [
    { field: 'client_total', label: clientName ? `${clientName}'s Total` : 'Client Total' },
    { field: 'spouse_total', label: spouseName ? `${spouseName}'s Total` : 'Spouse Total' },
    { field: 'joint_total', label: 'Joint Total' },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Enter approximate totals for all {label.toLowerCase()} combined.</p>
      {rows.map(({ field, label: rowLabel }) => (
        <FormField key={field} label={rowLabel}>
          <TextInput
            value={totals[field]}
            onChange={v => onChange({ ...totals, [field]: v })}
            placeholder="$0 or leave blank"
          />
        </FormField>
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
      <p className="text-sm text-muted-foreground">Describe your {label.toLowerCase()} — include approximate values if known.</p>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={6}
        placeholder={`Describe your ${label.toLowerCase()}…`}
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

export function StepEstate(props: StepProps) {
  return (
    <div className="space-y-6">
      <FormField label="Estimated Total Estate Value">
        <IntakeField
          fieldId="estate_value"
          value={props.data.estate_value}
          onChange={(v) => props.update('estate_value', v)}
          placeholder="Select a range"
        />
      </FormField>
      <FinancialAssetsBlock {...props} />
    </div>
  )
}

export function FinancialAssetsBlock({ data, update }: StepProps) {
  const [activeModal, setActiveModal] = useState<string | null>(null)
  const assetCheckboxId = useId()

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
      <FormField label="What types of assets do you own?">
        <p className="mb-2 text-xs text-muted-foreground">
          Check everything that applies. Tap &quot;Add details&quot; only if you want to share more now — it is optional.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {INTAKE_ASSET_TYPE_VALUES.map((asset) => {
            const isChecked = currentAssets.includes(asset)
            return (
              <div key={asset} className={cn('rounded-md border p-3 transition-colors', isChecked ? 'border-accent bg-teal-bg' : 'border-border hover:bg-accent')}>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 flex-1" htmlFor={`${assetCheckboxId}-${asset}`}>
                    <Checkbox
                      id={`${assetCheckboxId}-${asset}`}
                      checked={isChecked}
                      onCheckedChange={() => toggleAsset(asset)}
                    />
                    <span className="text-sm text-foreground">{assetTypeLabel(asset)}</span>
                  </label>
                  {isChecked && (
                    <button
                      type="button"
                      onClick={() => setActiveModal(asset)}
                      className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent hover:text-accent-foreground transition-colors border border-accent"
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
                <Textarea
                  value={circumstanceDetails[c.value] ?? ''}
                  onChange={(e) => updateCircumstanceDetail(c.value, e.target.value)}
                  rows={2}
                  placeholder="Please provide additional information…"
                  className="mt-2"
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

export function StepGoals(props: StepProps) {
  return (
    <div className="space-y-6">
      <PlanningObjectivesBlock {...props} />
      <PlanningGoalsField {...props} />
      <ExistingDocumentUploadsBlock {...props} />
      <FormField label="Anything else you'd like us to know?">
        <Textarea
          value={(props.data.special_notes as string) ?? ''}
          onChange={(e) => props.update('special_notes', e.target.value)}
          rows={4}
          placeholder="Any specific concerns, questions, or wishes you'd like to share..."
        />
      </FormField>
    </div>
  )
}

export function PlanningObjectivesBlock({ data, update }: StepProps) {
  // Guard the shape: legacy rows can surface this as a JSON string or admin
  // free text; spreading a string would corrupt it into a char-indexed object.
  const rawObjectives = data.planning_objectives
  const obj: Record<string, string> =
    rawObjectives && typeof rawObjectives === 'object' && !Array.isArray(rawObjectives)
      ? (rawObjectives as Record<string, string>)
      : {}
  function updateObj(field: string, val: string) {
    update('planning_objectives', { ...obj, [field]: val })
  }

  return (
    <div className="space-y-6">
      <FormField label="Why did you choose Aubrey Law?" optional>
        <Textarea
          value={obj.why_choose_firm ?? ''}
          onChange={(e) => updateObj('why_choose_firm', e.target.value)}
          rows={3}
          placeholder="A referral, online search, prior experience…"
        />
        <WhyWeAsk>
          This helps us understand what mattered to you when choosing counsel and tailor your first conversation.
        </WhyWeAsk>
      </FormField>

      <FormField label="Why are you planning now?" optional>
        <Textarea
          value={obj.why_now ?? ''}
          onChange={(e) => updateObj('why_now', e.target.value)}
          rows={3}
          placeholder="A life event, peace of mind, a nudge from family…"
        />
        <WhyWeAsk>
          Your timing and motivation help your attorney focus the plan on what is driving you right now.
        </WhyWeAsk>
      </FormField>

      <FormField label="Is making things easy for loved ones important to you?" optional>
        <Textarea
          value={obj.make_things_easy ?? ''}
          onChange={(e) => updateObj('make_things_easy', e.target.value)}
          rows={2}
          placeholder="Most clients say yes — share anything specific you have in mind."
        />
        <WhyWeAsk>
          Many clients want to spare family from confusion, conflict, or extra court steps. Your answer shapes how we structure the plan.
        </WhyWeAsk>
      </FormField>

    </div>
  )
}

function PlanningGoalsField({ data, update }: StepProps) {
  const currentGoals = (data.planning_goals as string[]) ?? (data.goals as string[]) ?? []
  function toggleGoal(goal: string) {
    update('planning_goals', currentGoals.includes(goal) ? currentGoals.filter((g) => g !== goal) : [...currentGoals, goal])
  }
  return (
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
                    ? 'border-selected-border bg-selected'
                    : 'border-border hover:border-border'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                    selected ? 'border-accent bg-accent text-white' : 'border-border'
                  )}>
                    {selected && <Check className="h-3 w-3" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{goal.label}</p>
                    <p className="text-xs text-muted-foreground">{goal.desc}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </FormField>
  )
}

export function ExistingDocumentUploadsBlock({ data, update, intakeId, publicIntakeToken, disabled }: StepProps & { disabled?: boolean }) {
  return (
    <div className="space-y-6">
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
            disabled={disabled}
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
            disabled={disabled}
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
            disabled={disabled}
            label="federal or state gift tax returns"
            publicIntakeToken={publicIntakeToken}
          />
        )}
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
        preferred_pronoun: '',
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
        <div key={row.id} className="rounded-lg border border-border bg-muted p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Additional contact {idx + 1}</span>
            <button type="button" onClick={() => removeRow(idx)} aria-label={`Remove additional contact ${idx + 1}`} className="text-destructive hover:text-red">
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
              <FormField label="Pronouns">
                <SelectInput
                  value={row.preferred_pronoun ?? ''}
                  onChange={(v) => patchRow(idx, { preferred_pronoun: v })}
                  placeholder="Select pronouns"
                  options={PRONOUN_OPTIONS}
                />
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

export const DEFAULT_FIDUCIARY_ENTRY: FiduciaryEntry = {
  first_name: '',
  middle_name: '',
  last_name: '',
  suffix: '',
  relationship: '',
  preferred_pronoun: '',
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
      preferred_pronoun: (n.preferred_pronoun ?? '').trim(),
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
    preferred_pronoun: (data.preferred_pronoun as string) || '',
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
    preferred_pronoun: ((data._spouse as Record<string, string> | undefined)?.preferred_pronoun) || '',
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
        preferred_pronoun: c.pronouns || '',
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
        <p className="text-sm text-muted-foreground">
          Name the people who would step in to manage your trust, settle your estate, and make decisions if you cannot.
          Many clients choose a spouse, adult child, or trusted sibling — you can leave any role blank and discuss options with Aubrey Law.
        </p>
        <ExpandableHelp title="Learn more about these roles">
          <p>
            If your plan includes a Trust, you&apos;ll need to decide who manages and distributes your assets. The same person can serve in both roles, but each carries distinct responsibilities.
          </p>
          <p>
            <span className="font-medium text-foreground">Successor Trustee:</span> Manages trust assets — property titled in the name of the Trust during your lifetime or made payable to the Trust at death. You will be the initial trustee of your own trust; the people you name here step in as successor trustees when you can no longer serve.
          </p>
          <p>
            <span className="font-medium text-foreground">Personal Representative (Executor):</span> Settles your probate estate — generally any property titled solely in your name at death that lacks a designated beneficiary, a Transfer/Payable on Death instruction, or Rights of Survivorship.
          </p>
          <p className="font-medium text-foreground">Which role does the heavy lifting?</p>
          <ul className="ml-4 list-disc space-y-1">
            <li><span className="font-medium text-foreground">Trust-Based Plan:</span>{' '}Both roles are necessary, but the Trustee typically carries more long-term responsibility, managing assets according to your Trust&apos;s instructions.</li>
            <li><span className="font-medium text-foreground">Will-Based Plan:</span> There is no Trustee. The Personal Representative handles all administrative work to close the estate through probate.</li>
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
    preferred_pronoun: (data.preferred_pronoun as string) || '',
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
        preferred_pronoun: c.pronouns || '',
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
    preferred_pronoun: (data.preferred_pronoun as string) || '',
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
    preferred_pronoun: ((data._spouse as Record<string, string> | undefined)?.preferred_pronoun) || '',
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
        preferred_pronoun: c.pronouns || '',
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
      selectors={{ getActiveSteps, getStepIssues }}
      data={data}
      intakeId={intakeId}
      publicIntakeToken={publicIntakeToken}
    />
  )
}

export const AdditionalContactsBlock = StepAdditionalContacts
export const ClientFiduciariesBlock = StepFiduciaries
export const SpouseFiduciariesBlock = StepSpouseFiduciaries
export const GuardianBlock = StepGuardian
export const ReviewSubmitBlock = StepReview
