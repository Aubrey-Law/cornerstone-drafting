'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const Viewer = dynamic(() => import('@/components/documents/DocxViewerPanel').then(m => m.DocxViewerPanel), { ssr: false })
type Target = { id: string; name: string; versionId?: string }

/** Authenticated in-app comparison. Historical bytes never go to an external viewer. */
export function DocumentComparisonDialog({ current, previous, onClose }: { current: Target; previous?: Target; onClose: () => void }) {
  const token = useAccessToken()
  const [prior, setPrior] = useState<Target | null>(null)
  const [active, setActive] = useState<Target>(current)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${current.id}/versions`, { headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) throw new Error('Could not load document history')
        const body = await response.json() as { current_version_id: string | null; versions: Array<{ id: string; version_number: number }> }
        const currentVersion = body.versions.find(v => v.id === body.current_version_id)
        const previousVersion = currentVersion ? body.versions.find(v => v.version_number < currentVersion.version_number) : null
        if (cancelled) return
        setActive({ ...current, versionId: currentVersion?.id })
        if (previous) setPrior(previous)
        else if (previousVersion) setPrior({ ...current, versionId: previousVersion.id })
        else setError('No previous version is available for this document.')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load history')
      }
    })()
    return () => { cancelled = true }
  }, [token, current, previous])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex h-[90vh] w-[96vw] sm:max-w-[1600px] flex-col">
      <DialogHeader><DialogTitle>Compare with previous — {current.name}</DialogTitle></DialogHeader>
      {error ? <p role="status">{error}</p> : prior ? <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto lg:grid-cols-2">
        <section className="flex min-h-[360px] flex-col overflow-hidden rounded border"><h3 className="p-2 text-sm font-medium">Previous version</h3><Viewer documentId={prior.id} documentName={prior.name} versionId={prior.versionId} readOnly onClose={onClose} /></section>
        <section className="flex min-h-[360px] flex-col overflow-hidden rounded border"><h3 className="p-2 text-sm font-medium">Current version</h3><Viewer documentId={active.id} documentName={active.name} versionId={active.versionId} readOnly onClose={onClose} /></section>
      </div> : <p role="status">Loading version history…</p>}
    </DialogContent>
  </Dialog>
}
