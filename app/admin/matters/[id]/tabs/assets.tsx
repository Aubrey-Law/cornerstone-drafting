'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AssetPortfolioSummary } from '@/components/assets/AssetPortfolioSummary'
import { AssetDonutChart } from '@/components/assets/AssetDonutChart'
import { AssetCategoryFilters } from '@/components/assets/AssetCategoryFilters'
import { AssetTable } from '@/components/assets/AssetTable'
import { AssetFormDialog } from '@/components/assets/AssetFormDialog'
import { ImportAssetsDialog } from '@/components/assets/ImportAssetsDialog'
import { computeAssetAggregates, groupAssetsByCategory } from '@/lib/assets/aggregates'
import { ASSET_CATEGORIES, ASSET_CHART_COLORS } from '@/lib/assets/categories'
import { buildOwnershipLabels } from '@/lib/assets/labels'
import type { AssetIntakeInput, AssetIntakeRow } from '@/types/assetIntake'
import { useMatterAssets } from '../useMatterAssets'

interface MatterAssetsTabProps {
  matterId?: string
  intakeId: string | null
  clientName?: string | null
  spouseName?: string | null
  maritalStatus?: string | null
  accessToken: string | null
  onAssetCountChange?: (count: number) => void
}

function MatterAssetsTabImpl({
  matterId,
  intakeId,
  clientName,
  spouseName,
  maritalStatus,
  accessToken,
  onAssetCountChange,
}: MatterAssetsTabProps) {
  const [filter, setFilter] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<AssetIntakeRow | null>(null)
  const [syncingDesignSheet, setSyncingDesignSheet] = useState(false)

  const {
    assets,
    assetCount,
    loading,
    saving,
    load,
    createAsset,
    updateAsset,
    deleteAsset,
    exportReport,
  } = useMatterAssets({
    intakeId,
    accessToken,
    enabled: Boolean(intakeId),
  })

  const ownershipLabels = useMemo(
    () => buildOwnershipLabels(clientName, spouseName),
    [clientName, spouseName],
  )

  const marriedForTax = useMemo(() => {
    const status = maritalStatus?.toLowerCase() ?? ''
    return status === 'married' || Boolean(spouseName?.trim())
  }, [maritalStatus, spouseName])

  const aggregates = useMemo(() => computeAssetAggregates(assets), [assets])
  const groups = useMemo(
    () => groupAssetsByCategory(assets, filter === 'all' ? null : filter),
    [assets, filter],
  )

  const allocationSegments = useMemo(() => {
    return ASSET_CATEGORIES.map((cat, i) => ({
      key: cat.key,
      label: cat.label,
      value: aggregates.byCategory[cat.key]?.total ?? 0,
      color: ASSET_CHART_COLORS[i % ASSET_CHART_COLORS.length],
    })).filter(s => s.value > 0)
  }, [aggregates.byCategory])

  const ownershipSegments = useMemo(
    () => [
      {
        key: 'client',
        label: ownershipLabels.client,
        value: aggregates.byOwnership.client.total,
        color: ASSET_CHART_COLORS[0],
      },
      {
        key: 'spouse',
        label: ownershipLabels.spouse,
        value: aggregates.byOwnership.spouse.total,
        color: ASSET_CHART_COLORS[2],
      },
      {
        key: 'joint',
        label: ownershipLabels.joint,
        value: aggregates.byOwnership.joint.total,
        color: ASSET_CHART_COLORS[4],
      },
    ].filter(s => s.value > 0),
    [aggregates.byOwnership, ownershipLabels],
  )

  useEffect(() => {
    onAssetCountChange?.(assetCount)
  }, [assetCount, onAssetCountChange])

  async function handleSave(input: AssetIntakeInput, assetId?: string) {
    if (assetId) {
      await updateAsset(assetId, input)
    } else {
      await createAsset(input)
    }
    setFormOpen(false)
    setEditingAsset(null)
  }

  function openAdd() {
    setEditingAsset(null)
    setFormOpen(true)
  }

  function openEdit(asset: AssetIntakeRow) {
    setEditingAsset(asset)
    setFormOpen(true)
  }

  async function handleDelete(asset: AssetIntakeRow) {
    const confirmed = window.confirm(`Delete "${asset.description || 'this asset'}"? This cannot be undone.`)
    if (!confirmed) return
    await deleteAsset(asset.id)
  }

  async function handleSyncDesignSheet() {
    if (!matterId) return
    setSyncingDesignSheet(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assets/sync-design-sheet`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Sync failed')
      toast.success(`Synced ${body.synced ?? 0} asset${body.synced === 1 ? '' : 's'} to design sheet`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sync assets to design sheet')
    } finally {
      setSyncingDesignSheet(false)
    }
  }

  if (!intakeId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">No intake linked to this matter</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create or import an intake before managing assets.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button className="gap-1.5 bg-brand-navy hover:bg-brand-navy/90" onClick={openAdd}>
          <Plus className="h-4 w-4" />
          Add new asset
        </Button>
        <Button type="button" variant="link" className="h-auto px-0 text-sm" onClick={() => setImportOpen(true)}>
          Import assets from spreadsheet or document
        </Button>
        {matterId && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={syncingDesignSheet || assets.length === 0}
            onClick={() => void handleSyncDesignSheet()}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingDesignSheet ? 'animate-spin' : ''}`} />
            Sync to design sheet
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">No assets added yet.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />
              Add First Asset
            </Button>
            <Button type="button" variant="link" size="sm" onClick={() => setImportOpen(true)}>
              Import assets from spreadsheet or document
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 rounded-lg border border-border bg-card p-4 md:grid-cols-3 md:p-6">
            <AssetPortfolioSummary aggregates={aggregates} married={marriedForTax} />
            <AssetDonutChart title="Asset allocation" segments={allocationSegments} />
            <AssetDonutChart title="Ownership split" segments={ownershipSegments} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <AssetCategoryFilters value={filter} onChange={setFilter} />
            <Button type="button" variant="link" className="h-auto px-0 text-sm" onClick={() => void exportReport()}>
              Export Asset Report
            </Button>
          </div>

          <AssetTable
            groups={groups}
            ownershipLabels={ownershipLabels}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </>
      )}

      <AssetFormDialog
        open={formOpen}
        onOpenChange={open => {
          setFormOpen(open)
          if (!open) setEditingAsset(null)
        }}
        asset={editingAsset}
        ownershipLabels={ownershipLabels}
        saving={saving}
        onSave={handleSave}
      />

      <ImportAssetsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        intakeId={intakeId}
        accessToken={accessToken}
        onImported={() => void load()}
      />
    </div>
  )
}

export const MatterAssetsTab = memo(MatterAssetsTabImpl)
