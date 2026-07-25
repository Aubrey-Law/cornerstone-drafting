'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { assetDebt, assetDocumentCount, assetNetValue, type CategoryGroup } from '@/lib/assets/aggregates'
import { formatAssetCurrency } from '@/lib/assets/format'
import type { OwnershipLabels } from '@/lib/assets/labels'
import { ownershipLabel } from '@/lib/assets/labels'
import type { AssetIntakeRow } from '@/types/assetIntake'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  const institution = asset.details?.institution
  return typeof institution === 'string' && institution.trim()
    ? institution.trim()
    : asset.description || 'Unnamed asset'
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
  const showDebt = visibleAssets.some(asset => assetDebt(asset) > 0)
  const showFiles = visibleAssets.some(asset => assetDocumentCount(asset) > 0)
  const columnCount = 7 + Number(showDebt) + Number(showFiles)
  const selectedVisibleCount = visibleIds.filter(id => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected
  const grandTotal = groups.reduce((sum, group) => sum + group.total, 0)
  const grandDebt = groups.reduce((sum, group) => sum + group.debt, 0)
  const grandNet = groups.reduce((sum, group) => sum + group.net, 0)

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 py-12 text-center">
        <p className="text-sm text-muted-foreground">No assets match this filter.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="w-10 px-3 py-3">
              <Checkbox
                checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                onCheckedChange={checked => onToggleAllVisible(visibleIds, checked === true)}
                aria-label="Select all visible assets"
              />
            </th>
            <th className="px-4 py-3">Asset</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3">Owner</th>
            <th className="px-4 py-3 text-right">Value</th>
            {showDebt && <th className="px-4 py-3 text-right">Debt</th>}
            <th className="px-4 py-3 text-right">Net value</th>
            {showFiles && <th className="px-4 py-3 text-center">Files</th>}
            <th className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {groups.map(group => {
            const isCollapsed = collapsed[group.key] ?? false
            return (
              <Fragment key={group.key}>
                <tr className="border-b border-border bg-muted/20 font-medium">
                  <td className="px-4 py-2.5" colSpan={columnCount}>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-left text-sm"
                      onClick={() => setCollapsed(previous => ({ ...previous, [group.key]: !isCollapsed }))}
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      {group.label} — {group.assets.length} asset{group.assets.length === 1 ? '' : 's'}
                    </button>
                  </td>
                </tr>
                {!isCollapsed && group.assets.map(asset => {
                  const debt = assetDebt(asset)
                  const fileCount = assetDocumentCount(asset)
                  return (
                    <tr
                      key={asset.id}
                      className={cn(
                        'group border-b border-border/60 hover:bg-muted/20',
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
                      <td className="px-4 py-2.5 font-medium">{assetDisplayName(asset)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{asset.description || '—'}</td>
                      <td className="px-4 py-2.5">{ownershipLabel(asset.ownership, ownershipLabels)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatAssetCurrency(asset.value)}</td>
                      {showDebt && (
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {debt > 0 ? formatAssetCurrency(debt) : '—'}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {formatAssetCurrency(assetNetValue(asset))}
                      </td>
                      {showFiles && (
                        <td className="px-4 py-2.5 text-center text-muted-foreground">{fileCount || '—'}</td>
                      )}
                      <td className="px-2 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-60 focus:opacity-100 group-hover:opacity-100"
                              aria-label={`Actions for ${assetDisplayName(asset)}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onEdit(asset)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => onDelete(asset)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )
                })}
                {!isCollapsed && (
                  <tr className="border-b border-border bg-muted/10 text-xs font-medium text-muted-foreground">
                    <td className="px-4 py-2 pl-10" colSpan={4}>{group.label} subtotal</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatAssetCurrency(group.total)}</td>
                    {showDebt && (
                      <td className="px-4 py-2 text-right tabular-nums">
                        {group.debt > 0 ? formatAssetCurrency(group.debt) : '—'}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums">{formatAssetCurrency(group.net)}</td>
                    <td colSpan={1 + Number(showFiles)} />
                  </tr>
                )}
              </Fragment>
            )
          })}
          <tr className="bg-muted/30 font-semibold">
            <td />
            <td className="px-4 py-3" colSpan={3}>Total</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatAssetCurrency(grandTotal)}</td>
            {showDebt && (
              <td className="px-4 py-3 text-right tabular-nums">
                {grandDebt > 0 ? formatAssetCurrency(grandDebt) : '—'}
              </td>
            )}
            <td className="px-4 py-3 text-right tabular-nums">{formatAssetCurrency(grandNet)}</td>
            <td colSpan={1 + Number(showFiles)} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
