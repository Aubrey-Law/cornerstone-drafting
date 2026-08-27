'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
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
import { billingMoney } from '@/lib/billing/metrics'
import type { ServicePackageOption } from '@/lib/billing/schedules'

export interface AttachFeeScheduleInput {
  packageId: string
  agreedTotalCents: number
}

/**
 * Splits an agreed fee across a package's milestones exactly as
 * `create_matter_fee_schedule` does, so the preview matches what will be
 * written: each milestone floors its share and the last one absorbs the
 * remainder, leaving no stray cent.
 */
export function previewMilestoneAmounts(
  option: ServicePackageOption,
  totalCents: number,
): number[] {
  const count = option.milestones.length
  if (count === 0 || totalCents <= 0) return []
  const amounts: number[] = []
  let allocated = 0
  option.milestones.forEach((milestone, index) => {
    const amount = index === count - 1
      ? totalCents - allocated
      : Math.floor((totalCents * (milestone.percentageBps ?? 0)) / 10000)
    amounts.push(amount)
    allocated += amount
  })
  return amounts
}

/**
 * Attaches a service package to a matter as its fee schedule. The first
 * milestone is released to the ledger immediately by the RPC, and the rest
 * release as the matter reaches their stage.
 */
export function AttachFeeScheduleDialog({
  open,
  onOpenChange,
  packages,
  saving,
  returnFocusRef,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  packages: ServicePackageOption[]
  saving: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onSave: (input: AttachFeeScheduleInput) => Promise<void>
}) {
  const [packageId, setPackageId] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Reseed on each open so a cancelled attempt never leaks into the next one.
  useEffect(() => {
    if (!open) return
    setPackageId(packages[0]?.id ?? '')
    setAmount('')
    setError(null)
  }, [open, packages])

  const selected = packages.find(option => option.id === packageId) ?? null
  const cents = Math.round(Number(amount) * 100)
  const validCents = Number.isSafeInteger(cents) && cents > 0
  const preview = useMemo(
    () => (selected && validCents ? previewMilestoneAmounts(selected, cents) : []),
    [selected, validCents, cents],
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!packageId) {
      setError('Choose a package.')
      return
    }
    if (!validCents) {
      setError('Enter an agreed fee greater than zero.')
      return
    }
    setError(null)
    await onSave({ packageId, agreedTotalCents: cents })
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
            <DialogTitle>Set a fee schedule</DialogTitle>
            <DialogDescription>
              Split this matter&apos;s agreed fee across a package&apos;s milestones. The first
              milestone bills right away; the rest bill as the matter reaches each stage. A
              matter that already carries charges cannot take a schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="schedule-package">Package</Label>
              <Select value={packageId} onValueChange={setPackageId}>
                <SelectTrigger id="schedule-package" aria-label="Package" className="min-h-11 w-full">
                  <SelectValue placeholder="Choose a package" />
                </SelectTrigger>
                <SelectContent>
                  {packages.map(option => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.practiceArea} — {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-amount">Agreed fee</Label>
              <Input
                id="schedule-amount"
                inputMode="decimal"
                placeholder="e.g. 3500.00"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="min-h-11"
              />
            </div>

            {selected && preview.length > 0 && (
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Milestones</p>
                <ul className="mt-2 space-y-1">
                  {selected.milestones.map((milestone, index) => (
                    <li
                      key={milestone.position}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0">{milestone.label}</span>
                      <span className="tabular-nums">{billingMoney(preview[index])}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Setting…' : 'Set schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
