'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import {
  assetDebt,
  assetDocumentCount,
  assetNetValue,
  categoryLabel,
  type CategoryGroup,
} from '@/lib/assets/aggregates'
import { formatAssetCurrency } from '@/lib/assets/format'
import type { OwnershipLabels } from '@/lib/assets/labels'
import { ownershipLabel } from '@/lib/assets/labels'
import { CATEGORY_DETAILS } from '@/lib/estateTax'
import type { AssetIntakeRow } from '@/types/assetIntake'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

interface AssetTableProps {
  groups: CategoryGroup[]
  ownershipLabels: OwnershipLabels
  selectedIds: Set<string>
  onToggleSelected: (assetId: string, checked: boolean) => void
  onToggleAllVisible: (assetIds: string[], checked: boolean) => void
  onEdit: (asset: AssetIntakeRow) => void
  onDelete: (asset: AssetIntakeRow) => void
}

function assetDisplayName(asset: AssetIntakeRow): string {
  const details = asset.details ?? {}
  const institution = details.institution
  if (typeof institution === 'string' && institution.trim()) {
    return institution.trim()
  }
  return asset.description || 'Unnamed asset'
}

function assetTypeLabel(asset: AssetIntakeRow): string {
  return categoryLabel(asset.category)
}

export function AssetTable({
  groups,
  ownershipLabels,
  selectedIds,
  onToggleSelected,
  onToggleAllVisible,
  onEdit,
  onDelete,
}: AssetTableProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const visibleAssets = groups.flatMap(group => group.assets)
  const visibleIds = visibleAssets.map(asset => asset.id)
  const selectedVisibleCount = visibleIds.filter(id => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected

  const grandTotal = groups.reduce((s, g) => s + g.total, 0)
  const grandDebt = groups.reduce((s, g) => s + g.debt, 0)
  const grandNet = groups.reduce((s, g) => s + g.net, 0)

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted py-12 text-center">
        <p className="text-sm text-muted-foreground">No assets match this filter.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="w-10 px-3 py-3">
              <Checkbox
                checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                onCheckedChange={checked => onToggleAllVisible(visibleIds, checked === true)}
                aria-label="Select all visible assets"
              />
            </th>
            <th className="px-4 py-3">Asset</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3 text-right">Value</th>
            <th className="px-4 py-3 text-right">Debt</th>
            <th className="px-4 py-3 text-right">Net Value</th>
            <th className="px-4 py-3 text-center">Files</th>
            <th className="px-4 py-3 w-20" />
          </tr>
        </thead>
        <tbody>
          {groups.map(group => {
            const isCollapsed = collapsed[group.key] ?? false
            return (
              <Fragment key={group.key}>
                <tr
                  key={`group-${group.key}`}
                  className="border-b border-border bg-muted font-medium"
                >
                  <td className="px-4 py-2.5" colSpan={9}>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left text-sm"
                      onClick={() => setCollapsed(prev => ({ ...prev, [group.key]: !isCollapsed }))}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      {group.label} — {group.assets.length} asset{group.assets.length === 1 ? '' : 's'}
                    </button>
                  </td>
                  <td />
                </tr>
                {!isCollapsed &&
                  group.assets.map(asset => {
                    const debt = assetDebt(asset)
                    const docCount = assetDocumentCount(asset)
                    const config = CATEGORY_DETAILS[asset.category]
                    return (
                      <tr
                        key={asset.id}
                        className={cn(
                          'border-b border-border/60 hover:bg-accent',
                          selectedIds.has(asset.id) && 'bg-brand-navy/5',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={selectedIds.has(asset.id)}
                            onCheckedChange={checked => onToggleSelected(asset.id, checked === true)}
                            aria-label={`Select ${asset.description || 'asset'}`}
                          />
                        </td>
                        <td className="px-4 py-2.5 pl-4 font-medium">{assetDisplayName(asset)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {asset.description || '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {config?.descriptionLabel ? assetTypeLabel(asset) : assetTypeLabel(asset)}
                        </td>
                        <td className="px-4 py-2.5">
                          {ownershipLabel(asset.ownership, ownershipLabels)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatAssetCurrency(asset.value)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {debt > 0 ? formatAssetCurrency(debt) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                          {formatAssetCurrency(assetNetValue(asset))}
                        </td>
                        <td className="px-4 py-2.5 text-center text-muted-foreground">
                          {docCount > 0 ? docCount : '—'}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => onEdit(asset)}
                              aria-label="Edit asset"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => onDelete(asset)}
                              aria-label="Delete asset"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                {!isCollapsed && (
                  <tr className="border-b border-border bg-muted text-xs font-medium text-muted-foreground">
                    <td className="px-4 py-2 pl-10" colSpan={5}>
                      {group.label} subtotal
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatAssetCurrency(group.total)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {group.debt > 0 ? formatAssetCurrency(group.debt) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatAssetCurrency(group.net)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </Fragment>
            )
          })}
          <tr className={cn('bg-muted font-semibold')}>
            <td className="px-3 py-3" />
            <td className="px-4 py-3" colSpan={4}>
              Total
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{formatAssetCurrency(grandTotal)}</td>
            <td className="px-4 py-3 text-right tabular-nums">
              {grandDebt > 0 ? formatAssetCurrency(grandDebt) : '—'}
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{formatAssetCurrency(grandNet)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
