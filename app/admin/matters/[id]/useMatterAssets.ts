'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { AssetIntakeInput, AssetIntakeRow } from '@/types/assetIntake'

interface UseMatterAssetsArgs {
  intakeId: string | null
  accessToken: string | null
  enabled?: boolean
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export function useMatterAssets({ intakeId, accessToken, enabled = true }: UseMatterAssetsArgs) {
  const [assets, setAssets] = useState<AssetIntakeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadedForIntakeId, setLoadedForIntakeId] = useState<string | null>(null)

  const loaded = loadedForIntakeId === intakeId

  const load = useCallback(async () => {
    if (!intakeId || !accessToken) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/assets/${intakeId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json().catch(() => [])
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to load assets')
      }
      setAssets(Array.isArray(data) ? data : [])
      setLoadedForIntakeId(intakeId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [intakeId, accessToken])

  useEffect(() => {
    if (intakeId !== loadedForIntakeId) {
      setAssets([])
      setLoadedForIntakeId(null)
    }
  }, [intakeId, loadedForIntakeId])

  useEffect(() => {
    if (enabled && intakeId && accessToken && intakeId !== loadedForIntakeId) {
      void load()
    }
  }, [enabled, intakeId, accessToken, loadedForIntakeId, load])

  const createAsset = useCallback(
    async (input: AssetIntakeInput) => {
      if (!intakeId || !accessToken) return
      setSaving(true)
      try {
        const res = await fetch(`/api/admin/assets/${intakeId}`, {
          method: 'POST',
          headers: authHeaders(accessToken),
          body: JSON.stringify(input),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to add asset')
        setAssets(prev => [...prev, data as AssetIntakeRow])
        toast.success('Asset added')
        return data as AssetIntakeRow
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add asset')
        throw err
      } finally {
        setSaving(false)
      }
    },
    [intakeId, accessToken],
  )

  const updateAsset = useCallback(
    async (assetId: string, input: AssetIntakeInput) => {
      if (!intakeId || !accessToken) return
      setSaving(true)
      try {
        const res = await fetch(`/api/admin/assets/${intakeId}`, {
          method: 'PATCH',
          headers: authHeaders(accessToken),
          body: JSON.stringify({ asset_id: assetId, ...input }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Failed to update asset')
        setAssets(prev =>
          prev.map(a =>
            a.id === assetId
              ? {
                  ...a,
                  ...input,
                  updated_at: new Date().toISOString(),
                }
              : a,
          ),
        )
        toast.success('Asset updated')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update asset')
        throw err
      } finally {
        setSaving(false)
      }
    },
    [intakeId, accessToken],
  )

  const deleteAsset = useCallback(
    async (assetId: string) => {
      if (!intakeId || !accessToken) return
      setSaving(true)
      try {
        const res = await fetch(
          `/api/admin/assets/${intakeId}?asset_id=${encodeURIComponent(assetId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        )
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Failed to delete asset')
        setAssets(prev => prev.filter(a => a.id !== assetId))
        toast.success('Asset deleted')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete asset')
        throw err
      } finally {
        setSaving(false)
      }
    },
    [intakeId, accessToken],
  )

  const deleteAssets = useCallback(
    async (assetIds: string[]) => {
      if (!intakeId || !accessToken || assetIds.length === 0) return
      setSaving(true)
      try {
        const res = await fetch(`/api/admin/assets/${intakeId}/bulk-delete`, {
          method: 'POST',
          headers: authHeaders(accessToken),
          body: JSON.stringify({ asset_ids: assetIds }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? 'Failed to delete assets')

        const deleted = Number(data.deleted) || 0
        const removed = new Set(assetIds)
        setAssets(prev => prev.filter(a => !removed.has(a.id)))
        toast.success(`Deleted ${deleted} asset${deleted === 1 ? '' : 's'}`)
        return deleted
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to delete assets')
        throw err
      } finally {
        setSaving(false)
      }
    },
    [intakeId, accessToken],
  )

  const exportReport = useCallback(async () => {
    if (!intakeId || !accessToken) return
    try {
      const res = await fetch(`/api/admin/assets/${intakeId}/export`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Export failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? 'assets_export.xlsx'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Asset report downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }, [intakeId, accessToken])

  const assetCount = useMemo(() => assets.length, [assets])

  return {
    assets,
    assetCount,
    loading,
    saving,
    loaded,
    load,
    createAsset,
    updateAsset,
    deleteAsset,
    deleteAssets,
    exportReport,
    setAssets,
  }
}
