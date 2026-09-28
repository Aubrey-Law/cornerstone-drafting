'use client'

import { useActionState, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
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
import { TONE_BADGE, TONE_NOTICE, type Tone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'
import { recordAssetFunding, type FundingFormState } from './actions'

const STATUS_TONE: Record<FundingStatus, Tone> = {
  not_started: 'neutral',
  in_progress: 'warning',
  // Sent is not funded: the state everyone mistakes for done gets the loudest badge.
  awaiting_confirmation: 'danger',
  confirmed: 'success',
  not_applicable: 'neutral',
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
    <li data-testid={`asset-${asset.assetId}`} className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm font-medium">{asset.description || categoryLabel(asset.category)}</p>
          <p className="text-xs text-muted-foreground">
            {categoryLabel(asset.category)}
            {asset.ownership ? ` · ${asset.ownership}` : ''} · {FUNDING_METHOD_LABELS[asset.method]}
            {asset.isRecorded ? '' : ' (suggested)'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums">{money(asset.value)}</span>
          <Badge variant="outline" className={cn('text-micro', TONE_BADGE[STATUS_TONE[asset.status]])}>
            {FUNDING_STATUS_LABELS[asset.status]}
            {asset.status === 'confirmed' && asset.confirmedOn
              ? ` · ${formatDate(asset.confirmedOn)}`
              : ''}
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(!open)}>
            {open ? 'Close' : isFunded(asset.status) ? 'Change' : 'Update'}
          </Button>
        </div>
      </div>

      {open ? (
        <form action={submit} className="mt-3 grid gap-3 rounded-lg border border-border bg-muted p-4 sm:grid-cols-2">
          <input type="hidden" name="matterId" value={matterId} />
          <input type="hidden" name="assetId" value={asset.assetId} />
          <input type="hidden" name="category" value={asset.category} />

          <div className="space-y-1.5">
            <Label htmlFor={`method-${asset.assetId}`}>How it joins the plan</Label>
            <NativeSelect id={`method-${asset.assetId}`} name="method" defaultValue={asset.method}>
              {methods.map((method) => (
                <option key={method} value={method}>
                  {FUNDING_METHOD_LABELS[method]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`status-${asset.assetId}`}>Status</Label>
            <NativeSelect
              id={`status-${asset.assetId}`}
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as FundingStatus)}
            >
              {FUNDING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {FUNDING_STATUS_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
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
            <p role="alert" className={cn('sm:col-span-2', TONE_NOTICE.danger)}>
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
