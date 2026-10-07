'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Plus, X } from 'lucide-react'
import { BillingMatterPicker } from '@/components/billing/BillingMatterPicker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addableBillingKinds,
  billingPlanLabels,
  billingPlans,
  MAX_CHARGES_PER_BATCH,
  type AddableBillingKind,
  type BillingPlan,
} from '@/lib/billing/types'
import { PLAN_FEE_SCHEDULES } from '@/lib/billing/planFeeSchedules'

export interface BillingMatterOption {
  hasLegalFee?: boolean
  id: string
  label: string
}

export interface AddChargeInput {
  matterId: string
  kind: AddableBillingKind
  label: string
  amountBilled: number
  plan: BillingPlan | null
}

const kindLabels: Record<AddableBillingKind, string> = {
  flat_fee: 'Legal Fee',
  plan_claim: 'Legal Plan Claim',
  cost: 'Cost',
}

const kindPlaceholders: Record<AddableBillingKind, string> = {
  flat_fee: 'e.g. Trust package',
  plan_claim: 'e.g. MetLife claim',
  cost: 'e.g. Deed recording fee',
}

const planLabels: Record<BillingPlan, string> = billingPlanLabels

/** An existing charge being corrected, rather than a new one being added. */
export interface EditableCharge {
  id: string
  kind: AddableBillingKind
  label: string
  amountBilled: number
  plan: BillingPlan | null
}

/**
 * Narrows a ledger row to the fields the form edits. Wrap the call in a memo
 * keyed on the row: the dialog reseeds whenever this value changes, so a fresh
 * object every render would wipe the form as it is typed into.
 */
export function editableCharge(row: {
  id: string
  kind: AddableBillingKind
  label: string
  amountBilled: number
  plan: BillingPlan | null
}): EditableCharge {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    amountBilled: row.amountBilled,
    plan: row.plan,
  }
}

/** One charge being entered. The dialog holds several when adding. */
interface ChargeLine {
  key: number
  kind: AddableBillingKind
  label: string
  amount: string
  plan: BillingPlan
  /** The carrier fee schedule row this line was filled from, or 'custom'. */
  feeKey: string
  feeInput: string
}

function blankLine(key: number, kind: AddableBillingKind, plan: BillingPlan): ChargeLine {
  return { key, kind, label: '', amount: '', plan, feeKey: 'custom', feeInput: '' }
}

/** Fills a line's description and amount from its carrier's fee schedule. */
function withScheduleFee(line: ChargeLine, key: string, rawInput = ''): ChargeLine {
  const schedule = PLAN_FEE_SCHEDULES[line.plan]
  const entry = schedule?.entries.find(candidate => candidate.key === key)
  if (!schedule || !entry) return { ...line, feeKey: key, feeInput: rawInput, label: '', amount: '' }
  const numericInput = rawInput === '' ? undefined : Number(rawInput)
  const cents = schedule.amountCents(key, numericInput)
  return {
    ...line,
    feeKey: key,
    feeInput: rawInput,
    label: entry.label,
    amount: cents === null ? '' : (cents / 100).toFixed(2),
  }
}

function formatDollars(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/**
 * Adds legal fees, costs or legal plan claims to a matter, or corrects one
 * already billed. Shared by the matter Billing tab (matter fixed, no picker) and
 * the firm billing workspace (picks a matter).
 *
 * Adding takes several lines at once — a fee plus its recording costs, or a
 * claim per MetLife schedule item — all for the one matter, saved together.
 *
 * A legal fee may be added here even though a signed engagement seeds one too:
 * the seeded row is source='engagement' and this one is source='manual'.
 *
 * Editing reuses the same form because the fields and the rules behind them are
 * the same; only the matter is off limits, since payments already hang off the
 * charge where it is. An edit is always a single line.
 */
export function AddChargeDialog({
  open,
  onOpenChange,
  matterId,
  matters,
  matterIdsWithLegalFee,
  defaultKind = 'flat_fee',
  defaultPlan = 'metlife',
  editing,
  saving,
  returnFocusRef,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed matter. Omit to let the user choose from `matters`. */
  matterId?: string
  /** Selectable matters. Omit when `matterId` is fixed. */
  matters?: BillingMatterOption[]
  /** Matters that already carry a legal fee, so a second one can be warned about. */
  matterIdsWithLegalFee?: readonly string[]
  /** Initial type for a new entry, such as the matter tab's Start a claim action. */
  defaultKind?: AddableBillingKind
  /** Initial carrier for a new legal-plan claim. */
  defaultPlan?: BillingPlan
  /** Seeds the form from an existing charge and switches to editing it. */
  editing?: EditableCharge
  saving: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  /** Every line, in entry order, all for the same matter. One line when editing. */
  onSave: (inputs: AddChargeInput[]) => Promise<void>
}) {
  const picking = matterId === undefined && !editing
  const [selectedMatter, setSelectedMatter] = useState('')
  const [selectedHasLegalFee, setSelectedHasLegalFee] = useState(false)
  const [lines, setLines] = useState<ChargeLine[]>(() => [blankLine(0, defaultKind, defaultPlan)])
  const [error, setError] = useState<string | null>(null)
  const nextKey = useRef(1)
  const focusKey = useRef<number | null>(null)
  const labelInputs = useRef(new Map<number, HTMLInputElement>())

  const multiple = lines.length > 1
  const targetMatter = matterId ?? selectedMatter
  // Advisory only: a matter may legitimately carry a second fee for additional
  // work, and the seeded engagement fee is a separate source='engagement' row.
  // An edit never warns — the fee it would be duplicating is itself.
  const duplicateLegalFee =
    !editing
    && lines.some(line => line.kind === 'flat_fee')
    && targetMatter !== ''
    && ((matterIdsWithLegalFee ?? []).includes(targetMatter) || (picking && selectedHasLegalFee))

  const totalCents = lines.reduce((sum, line) => {
    const cents = Math.round(Number(line.amount) * 100)
    return Number.isSafeInteger(cents) && cents > 0 ? sum + cents : sum
  }, 0)

  // Reseed on each open so a cancelled entry never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setSelectedMatter(matterId ?? matters?.[0]?.id ?? '')
    setSelectedHasLegalFee(Boolean(matters?.[0]?.hasLegalFee))
    nextKey.current = 1
    setLines([
      editing
        ? {
            ...blankLine(0, editing.kind, editing.plan ?? defaultPlan),
            label: editing.label,
            amount: (editing.amountBilled / 100).toFixed(2),
          }
        : blankLine(0, defaultKind, defaultPlan),
    ])
    setError(null)
  }, [open, matterId, matters, editing, defaultKind, defaultPlan])

  // Move to a freshly added line's description, as the first line's autofocus does.
  useEffect(() => {
    if (focusKey.current === null) return
    labelInputs.current.get(focusKey.current)?.focus()
    focusKey.current = null
  }, [lines])

  function updateLine(key: number, change: (line: ChargeLine) => ChargeLine) {
    setLines(current => current.map(line => (line.key === key ? change(line) : line)))
  }

  function changeKind(key: number, value: AddableBillingKind) {
    updateLine(key, line => {
      const next = { ...line, kind: value }
      return value !== 'plan_claim' && line.feeKey !== 'custom'
        ? withScheduleFee(next, 'custom')
        : next
    })
  }

  function changePlan(key: number, value: BillingPlan) {
    updateLine(key, line => {
      const next = { ...line, plan: value }
      // Each carrier has its own schedule, so a row picked for one never carries over.
      return value !== line.plan && line.feeKey !== 'custom'
        ? withScheduleFee(next, 'custom')
        : next
    })
  }

  function addLine() {
    const key = nextKey.current++
    focusKey.current = key
    setLines(current => {
      // A new line starts as the type and carrier of the one above it: a run of
      // costs or of schedule claims is the common case.
      const last = current[current.length - 1]
      return [...current, blankLine(key, last?.kind ?? defaultKind, last?.plan ?? defaultPlan)]
    })
  }

  function removeLine(key: number) {
    setLines(current => current.filter(line => line.key !== key))
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!targetMatter) {
      setError('Choose a matter.')
      return
    }
    const inputs: AddChargeInput[] = []
    for (const [index, line] of lines.entries()) {
      const prefix = multiple ? `Charge ${index + 1}: ` : ''
      const trimmed = line.label.trim()
      if (!trimmed) {
        setError(`${prefix}Enter a description for this charge.`)
        return
      }
      const cents = Math.round(Number(line.amount) * 100)
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        setError(`${prefix}Enter an amount greater than zero.`)
        return
      }
      inputs.push({
        matterId: targetMatter,
        kind: line.kind,
        label: trimmed,
        amountBilled: cents,
        plan: line.kind === 'plan_claim' ? line.plan : null,
      })
    }
    setError(null)
    await onSave(inputs)
  }

  const title = editing ? 'Edit charge' : multiple ? 'Add charges' : 'Add charge'
  const submitLabel = editing
    ? 'Save charge'
    : multiple ? `Add ${lines.length} charges` : 'Add charge'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90dvh,44rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <form onSubmit={event => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Correct the type, description or amount. Payments already logged stay with the charge, and the amount cannot fall below them.'
                : 'Add legal fees, legal plan claims, or costs already incurred — one line per charge. Advance cost deposits are not accepted.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            {picking && (
              <div className="space-y-2">
                <Label htmlFor="charge-matter">Matter</Label>
                <BillingMatterPicker id="charge-matter" value={selectedMatter} onChange={(id,hasLegalFee)=>{setSelectedMatter(id);setSelectedHasLegalFee(Boolean(hasLegalFee))}} initialOptions={matters ?? []} />
              </div>
            )}

            {lines.map((line, index) => (
              <ChargeLineFields
                key={line.key}
                line={line}
                number={multiple ? index + 1 : null}
                editing={Boolean(editing)}
                autoFocus={index === 0}
                labelRef={element => {
                  if (element) labelInputs.current.set(line.key, element)
                  else labelInputs.current.delete(line.key)
                }}
                onKindChange={value => changeKind(line.key, value)}
                onPlanChange={value => changePlan(line.key, value)}
                onScheduleFeeChange={(key, rawInput) =>
                  updateLine(line.key, current => withScheduleFee(current, key, rawInput))}
                onLabelChange={value => updateLine(line.key, current => ({ ...current, label: value }))}
                onAmountChange={value => updateLine(line.key, current => ({ ...current, amount: value }))}
                onRemove={multiple ? () => removeLine(line.key) : undefined}
              />
            ))}

            {!editing && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                  disabled={lines.length >= MAX_CHARGES_PER_BATCH}
                >
                  <Plus aria-hidden="true" />
                  Add another charge
                </Button>
                {multiple && (
                  <p className="text-sm text-muted-foreground tabular-nums">
                    Total {formatDollars(totalCents)}
                  </p>
                )}
              </div>
            )}

            {duplicateLegalFee && (
              <p
                role="status"
                className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber"
              >
                This matter already has a legal fee. Add another only if it is for
                additional work — otherwise the matter will be billed twice.
              </p>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (picking && (matters ?? []).length === 0)}>
              {saving ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One charge's fields. With several lines on screen each sits in a numbered
 * group and its labels carry the number, so a screen reader can tell
 * "Amount, charge 2" from the rest.
 */
function ChargeLineFields({
  line,
  number,
  editing,
  autoFocus,
  labelRef,
  onKindChange,
  onPlanChange,
  onScheduleFeeChange,
  onLabelChange,
  onAmountChange,
  onRemove,
}: {
  line: ChargeLine
  /** Position among several lines; null when this is the only one. */
  number: number | null
  editing: boolean
  autoFocus: boolean
  labelRef: (element: HTMLInputElement | null) => void
  onKindChange: (value: AddableBillingKind) => void
  onPlanChange: (value: BillingPlan) => void
  onScheduleFeeChange: (key: string, rawInput?: string) => void
  onLabelChange: (value: string) => void
  onAmountChange: (value: string) => void
  onRemove?: () => void
}) {
  const id = (field: string) => `charge-${field}-${line.key}`
  const suffix = number === null ? null : <span className="sr-only">, charge {number}</span>
  const schedule = line.kind === 'plan_claim' && !editing ? PLAN_FEE_SCHEDULES[line.plan] : undefined
  const selectedFee = schedule?.entries.find(entry => entry.key === line.feeKey)
  const scheduleFilled = Boolean(selectedFee)

  const fields = (
    <>
      <div className="space-y-2">
        <Label htmlFor={id('kind')}>Type{suffix}</Label>
        <Select value={line.kind} onValueChange={value => onKindChange(value as AddableBillingKind)}>
          <SelectTrigger id={id('kind')} className="min-h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {addableBillingKinds.map(value => (
              <SelectItem key={value} value={value}>{kindLabels[value]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {line.kind === 'plan_claim' && (
        <>
          <div className="space-y-2">
            <Label htmlFor={id('plan')}>Legal plan{suffix}</Label>
            <Select value={line.plan} onValueChange={value => onPlanChange(value as BillingPlan)}>
              <SelectTrigger id={id('plan')} className="min-h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {billingPlans.map(value => (
                  <SelectItem key={value} value={value}>{planLabels[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {schedule && (
            <div className="space-y-2">
              <Label htmlFor={id('schedule-fee')}>{schedule.pickerLabel}{suffix}</Label>
              <Select value={line.feeKey} onValueChange={value => onScheduleFeeChange(value)}>
                <SelectTrigger id={id('schedule-fee')} className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom or combined claim</SelectItem>
                  {schedule.entries.map(entry => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{schedule.source}</p>
            </div>
          )}

          {selectedFee?.input && (
            <div className="space-y-2">
              <Label htmlFor={id('schedule-input')}>{selectedFee.input.label}{suffix}</Label>
              <Input
                id={id('schedule-input')}
                type="number"
                min="0"
                step={selectedFee.input.step}
                inputMode="decimal"
                value={line.feeInput}
                onChange={event => onScheduleFeeChange(line.feeKey, event.target.value)}
                className="min-h-11 tabular-nums"
              />
              {selectedFee.input.help && (
                <p className="text-xs text-muted-foreground">{selectedFee.input.help}</p>
              )}
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor={id('label')}>Description{suffix}</Label>
        <Input
          ref={labelRef}
          id={id('label')}
          value={line.label}
          onChange={event => onLabelChange(event.target.value)}
          placeholder={kindPlaceholders[line.kind]}
          maxLength={200}
          className="min-h-11"
          autoFocus={autoFocus}
          readOnly={scheduleFilled}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={id('amount')}>Amount{suffix}</Label>
        <Input
          id={id('amount')}
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={line.amount}
          onChange={event => onAmountChange(event.target.value)}
          className="min-h-11 tabular-nums"
          readOnly={scheduleFilled}
        />
      </div>
    </>
  )

  if (number === null) return fields

  return (
    // The legend stays the fieldset's first child so it names the group; the
    // remove button sits over its row instead of sharing a wrapper with it.
    <fieldset className="relative space-y-4 rounded-md border border-border p-3">
      <legend className="float-left min-h-8 py-1.5 text-sm font-medium">Charge {number}</legend>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 size-8"
          onClick={onRemove}
          aria-label={`Remove charge ${number}`}
        >
          <X aria-hidden="true" />
        </Button>
      )}
      <div className="clear-both space-y-4">{fields}</div>
    </fieldset>
  )
}
