'use client'

import { useEffect, useState, type RefObject } from 'react'
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
  billingPlans,
  type AddableBillingKind,
  type BillingPlan,
} from '@/lib/billing/types'
import {
  calculateMetlifeScheduleAmount,
  METLIFE_FEE_SCHEDULE_SOURCE,
  METLIFE_SCHEDULE_ITEMS,
  metlifeScheduleLabel,
} from '@/lib/metlife/pricing'

export interface BillingMatterOption {
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

const planLabels: Record<BillingPlan, string> = {
  metlife: 'MetLife',
  legalease: 'LegalEASE',
}

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

/**
 * Adds a cost or legal plan claim to a matter, or corrects one already billed.
 * Shared by the matter Billing tab (matter fixed, no picker) and the firm
 * billing workspace (picks a matter).
 *
 * A legal fee may be added here even though a signed engagement seeds one too:
 * the seeded row is source='engagement' and this one is source='manual'.
 *
 * Editing reuses the same form because the fields and the rules behind them are
 * the same; only the matter is off limits, since payments already hang off the
 * charge where it is.
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
  onSave: (input: AddChargeInput) => Promise<void>
}) {
  const picking = matterId === undefined && !editing
  const [selectedMatter, setSelectedMatter] = useState('')
  const [kind, setKind] = useState<AddableBillingKind>('flat_fee')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [plan, setPlan] = useState<BillingPlan>('metlife')
  const [metlifeFeeKey, setMetlifeFeeKey] = useState('custom')
  const [metlifeFeeInput, setMetlifeFeeInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targetMatter = matterId ?? selectedMatter
  // Advisory only: a matter may legitimately carry a second fee for additional
  // work, and the seeded engagement fee is a separate source='engagement' row.
  // An edit never warns — the fee it would be duplicating is itself.
  const duplicateLegalFee =
    !editing
    && kind === 'flat_fee'
    && targetMatter !== ''
    && (matterIdsWithLegalFee ?? []).includes(targetMatter)

  // Reseed on each open so a cancelled entry never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setSelectedMatter(matterId ?? matters?.[0]?.id ?? '')
    setKind(editing?.kind ?? defaultKind)
    setLabel(editing?.label ?? '')
    setAmount(editing ? (editing.amountBilled / 100).toFixed(2) : '')
    setPlan(editing?.plan ?? defaultPlan)
    setMetlifeFeeKey('custom')
    setMetlifeFeeInput('')
    setError(null)
  }, [open, matterId, matters, editing, defaultKind, defaultPlan])

  const selectedMetlifeFee = METLIFE_SCHEDULE_ITEMS.find(item => item.key === metlifeFeeKey)

  function applyMetlifeFee(key: string, rawInput = '') {
    setMetlifeFeeKey(key)
    setMetlifeFeeInput(rawInput)
    const item = METLIFE_SCHEDULE_ITEMS.find(candidate => candidate.key === key)
    if (!item) {
      setLabel('')
      setAmount('')
      return
    }
    setLabel(metlifeScheduleLabel(item))
    const numericInput = rawInput === '' ? undefined : Number(rawInput)
    const cents = calculateMetlifeScheduleAmount(item, numericInput)
    setAmount(cents === null ? '' : (cents / 100).toFixed(2))
  }

  function changeKind(value: AddableBillingKind) {
    setKind(value)
    if (value !== 'plan_claim' && metlifeFeeKey !== 'custom') {
      applyMetlifeFee('custom')
    }
  }

  function changePlan(value: BillingPlan) {
    setPlan(value)
    if (value !== 'metlife' && metlifeFeeKey !== 'custom') {
      applyMetlifeFee('custom')
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!targetMatter) {
      setError('Choose a matter.')
      return
    }
    const trimmed = label.trim()
    if (!trimmed) {
      setError('Enter a description for this charge.')
      return
    }
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setError(null)
    await onSave({
      matterId: targetMatter,
      kind,
      label: trimmed,
      amountBilled: cents,
      plan: kind === 'plan_claim' ? plan : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90dvh,36rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <form onSubmit={event => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit charge' : 'Add charge'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Correct the type, description or amount. Payments already logged stay with the charge, and the amount cannot fall below them.'
                : 'Add a legal fee, a legal plan claim, or a pass-through cost. It starts awaiting invoice.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            {picking && (
              <div className="space-y-2">
                <Label htmlFor="charge-matter">Matter</Label>
                <Select value={selectedMatter} onValueChange={setSelectedMatter}>
                  <SelectTrigger id="charge-matter" aria-label="Matter" className="min-h-11 w-full">
                    <SelectValue placeholder="Choose a matter" />
                  </SelectTrigger>
                  <SelectContent>
                    {(matters ?? []).map(matter => (
                      <SelectItem key={matter.id} value={matter.id}>
                        {matter.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="charge-kind">Type</Label>
              <Select
                value={kind}
                onValueChange={value => changeKind(value as AddableBillingKind)}
              >
                <SelectTrigger id="charge-kind" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {addableBillingKinds.map(value => (
                    <SelectItem key={value} value={value}>{kindLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === 'plan_claim' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="charge-plan">Legal plan</Label>
                  <Select value={plan} onValueChange={value => changePlan(value as BillingPlan)}>
                    <SelectTrigger id="charge-plan" className="min-h-11 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {billingPlans.map(value => (
                        <SelectItem key={value} value={value}>{planLabels[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {plan === 'metlife' && !editing && (
                  <div className="space-y-2">
                    <Label htmlFor="metlife-fee-item">MetLife fee schedule item</Label>
                    <Select value={metlifeFeeKey} onValueChange={value => applyMetlifeFee(value)}>
                      <SelectTrigger id="metlife-fee-item" className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">Custom or combined claim</SelectItem>
                        {METLIFE_SCHEDULE_ITEMS.map(item => (
                          <SelectItem key={item.key} value={item.key}>
                            {metlifeScheduleLabel(item)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Massachusetts schedule · location {METLIFE_FEE_SCHEDULE_SOURCE.locationCode}
                    </p>
                  </div>
                )}

                {selectedMetlifeFee?.input && plan === 'metlife' && !editing && (
                  <div className="space-y-2">
                    <Label htmlFor="metlife-fee-input">{selectedMetlifeFee.inputLabel}</Label>
                    <Input
                      id="metlife-fee-input"
                      type="number"
                      min="0"
                      step={selectedMetlifeFee.input === 'probate_assets' ? '0.01' : '0.25'}
                      inputMode="decimal"
                      value={metlifeFeeInput}
                      onChange={event => applyMetlifeFee(metlifeFeeKey, event.target.value)}
                      className="min-h-11 tabular-nums"
                    />
                    <p className="text-xs text-muted-foreground">
                      {selectedMetlifeFee.input === 'probate_assets'
                        ? '1.5% through $100,000 (minimum $450), then 1% over $100,000; maximum $4,000.'
                        : '$1,000 through 10 hours, then $100 per additional hour; maximum $2,000.'}
                    </p>
                  </div>
                )}
              </>
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

            <div className="space-y-2">
              <Label htmlFor="charge-label">Description</Label>
              <Input
                id="charge-label"
                value={label}
                onChange={event => setLabel(event.target.value)}
                placeholder={kindPlaceholders[kind]}
                maxLength={200}
                className="min-h-11"
                autoFocus
                readOnly={kind === 'plan_claim' && Boolean(selectedMetlifeFee) && plan === 'metlife' && !editing}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="charge-amount">Amount</Label>
              <Input
                id="charge-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="min-h-11 tabular-nums"
                readOnly={kind === 'plan_claim' && Boolean(selectedMetlifeFee) && plan === 'metlife' && !editing}
              />
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (picking && (matters ?? []).length === 0)}>
              {saving ? 'Saving…' : editing ? 'Save charge' : 'Add charge'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
