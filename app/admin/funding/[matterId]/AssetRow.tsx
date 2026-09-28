'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  FUNDING_METHOD_LABELS,
  FUNDING_STATUSES,
  FUNDING_STATUS_LABELS,
  categoryLabel,
  isFunded,
  permittedMethodsFor,
  type FundingStatus,
} from '@/lib/funding/model'
import { formatDate, formatMoney } from '@/lib/funding/format'
import type { FundingAsset } from '@/lib/funding/rollup'
import { recordAssetFunding, type FundingFormState } from './actions'

const STATUS_CLASS: Record<FundingStatus, string> = {
  not_started: 'border-border bg-muted text-muted-foreground',
  in_progress: 'border-warning/50 bg-warning/10 text-foreground',
  // Sent is not funded: the state everyone mistakes for done gets the loudest badge.
  awaiting_confirmation: 'border-destructive/40 bg-destructive/10 text-foreground',
  confirmed: 'border-success/50 bg-success/10 text-foreground',
  not_applicable: 'border-border bg-muted text-muted-foreground',
}

const money = (value: number | string | null) => {
  const amount = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof amount === 'number' && Number.isFinite(amount) ? formatMoney(amount) : '—'
}

export function AssetRow({ matterId, asset }: { matterId: string; asset: FundingAsset }) {
  const [open, setOpen] = useState(false)
  const [state, submit, pending] = useActionState(recordAssetFunding, { message: null } as FundingFormState)
  const [status, setStatus] = useState<FundingStatus>(asset.status)

  /**
   * Only the methods this category permits are offered. A retirement account
   * has no "retitle" option at all, because retitling one into a revocable
   * trust is a taxable distribution of the whole account — a thing the form
   * should not be able to express, rather than a thing it warns about after.
   */
  const methods = permittedMethodsFor(asset.category)

  return (
    <li data-testid={`asset-${asset.assetId}`} className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium">{asset.description || categoryLabel(asset.category)}</p>
          <p className="text-xs text-muted-foreground">
            {categoryLabel(asset.category)}
            {asset.ownership ? ` · ${asset.ownership}` : ''} · {FUNDING_METHOD_LABELS[asset.method]}
            {asset.isRecorded ? '' : ' (suggested)'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums">{money(asset.value)}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[asset.status]}`}>
            {FUNDING_STATUS_LABELS[asset.status]}
            {asset.status === 'confirmed' && asset.confirmedOn
              ? ` · ${formatDate(asset.confirmedOn)}`
              : ''}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? 'Close' : isFunded(asset.status) ? 'Change' : 'Update'}
          </Button>
        </div>
      </div>

      {open ? (
        <form action={submit} className="mt-4 grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
          <input type="hidden" name="matterId" value={matterId} />
          <input type="hidden" name="assetId" value={asset.assetId} />
          <input type="hidden" name="category" value={asset.category} />

          <div className="space-y-1.5">
            <Label htmlFor={`method-${asset.assetId}`}>How it joins the plan</Label>
            <select
              id={`method-${asset.assetId}`}
              name="method"
              defaultValue={asset.method}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {methods.map((method) => (
                <option key={method} value={method}>
                  {FUNDING_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`status-${asset.assetId}`}>Status</Label>
            <select
              id={`status-${asset.assetId}`}
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as FundingStatus)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {FUNDING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {FUNDING_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          {status === 'confirmed' ? (
            <div className="space-y-1.5">
              <Label htmlFor={`confirmed-${asset.assetId}`}>Confirmation received</Label>
              <Input
                id={`confirmed-${asset.assetId}`}
                name="confirmedOn"
                type="date"
                required
                defaultValue={asset.confirmedOn ?? ''}
              />
              {/* The distinction the tracker exists for. */}
              <p className="text-xs text-muted-foreground">
                The date the institution confirmed it, not the date the form was sent.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`note-${asset.assetId}`}>Note</Label>
            <Input id={`note-${asset.assetId}`} name="note" defaultValue={asset.note ?? ''} />
          </div>

          {state.message ? (
            <p role="alert" className="sm:col-span-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {state.message}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}
