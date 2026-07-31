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
  billingPlans,
  type AddableBillingKind,
  type BillingPlan,
} from '@/lib/billing/types'

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
  cost: 'Cost',
  plan_claim: 'Legal plan claim',
}

const planLabels: Record<BillingPlan, string> = {
  metlife: 'MetLife',
  legalease: 'LegalEASE',
}

/**
 * Adds a cost or legal plan claim to a matter. Shared by the matter Billing tab
 * (matter fixed, no picker) and the firm billing workspace (picks a matter).
 *
 * The flat fee is deliberately absent: it is seeded from the signed engagement.
 */
export function AddChargeDialog({
  open,
  onOpenChange,
  matterId,
  matters,
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
  saving: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onSave: (input: AddChargeInput) => Promise<void>
}) {
  const picking = matterId === undefined
  const [selectedMatter, setSelectedMatter] = useState('')
  const [kind, setKind] = useState<AddableBillingKind>('cost')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [plan, setPlan] = useState<BillingPlan>('metlife')
  const [error, setError] = useState<string | null>(null)

  // Reseed on each open so a cancelled entry never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setSelectedMatter(matterId ?? matters?.[0]?.id ?? '')
    setKind('cost')
    setLabel('')
    setAmount('')
    setPlan('metlife')
    setError(null)
  }, [open, matterId, matters])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const targetMatter = matterId ?? selectedMatter
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
            <DialogTitle>Add charge</DialogTitle>
            <DialogDescription>
              Add a pass-through cost or a legal plan claim. It starts awaiting invoice.
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
                onValueChange={value => setKind(value as AddableBillingKind)}
              >
                <SelectTrigger id="charge-kind" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(kindLabels).map(([value, text]) => (
                    <SelectItem key={value} value={value}>{text}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === 'plan_claim' && (
              <div className="space-y-2">
                <Label htmlFor="charge-plan">Legal plan</Label>
                <Select value={plan} onValueChange={value => setPlan(value as BillingPlan)}>
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
            )}

            <div className="space-y-2">
              <Label htmlFor="charge-label">Description</Label>
              <Input
                id="charge-label"
                value={label}
                onChange={event => setLabel(event.target.value)}
                placeholder={kind === 'cost' ? 'e.g. Deed recording fee' : 'e.g. MetLife claim'}
                maxLength={200}
                className="min-h-11"
                autoFocus
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
              />
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (picking && (matters ?? []).length === 0)}>
              {saving ? 'Saving…' : 'Add charge'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
