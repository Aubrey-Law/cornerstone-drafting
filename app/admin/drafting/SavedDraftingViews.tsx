'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUserPreferences } from '@/lib/userPreferencesClient'
import { DEFAULT_HUB_VIEW, parseSavedHubViews, type HubView, type SavedHubView } from '@/lib/drafting/hubView'

export function SavedDraftingViews({ view, onChange }: { view: HubView; onChange: (view: HubView) => void }) {
  const { loadPreferences, savePreferences } = useUserPreferences()
  const [saved, setSaved] = useState<SavedHubView[]>([])
  const [ready, setReady] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let cancelled = false
    void loadPreferences().then(prefs => {
      if (!cancelled) { setSaved(parseSavedHubViews(prefs?.drafting?.hubViews)); setReady(prefs !== null) }
    }).catch(() => { if (!cancelled) setReady(false) })
    return () => { cancelled = true }
  }, [loadPreferences])

  async function persist(next: SavedHubView[]) {
    setBusy(true)
    try {
      const result = await savePreferences({ drafting: { hubViews: next } })
      if (!result) throw new Error('Could not save this view. Please try again.')
      setSaved(next)
      setOpen(false)
      setName('')
    } catch {
      toast.error('Could not save this view. Please try again.')
    } finally { setBusy(false) }
  }
  const trimmed = name.trim()
  const exists = saved.some(item => item.name === trimmed)
  return (
    <>
      <select aria-label="Saved drafting views" value="" onChange={event => {
        const value = event.target.value
        if (value === 'all') onChange(DEFAULT_HUB_VIEW)
        else if (value === 'generate' || value === 'review') onChange({ ...DEFAULT_HUB_VIEW, action: value })
        else { const item = saved[Number(value)]; if (item) onChange(item) }
      }} className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground">
        <option value="" disabled>Saved views</option>
        <option value="all">All drafting work</option>
        <option value="generate">Ready to generate</option>
        <option value="review">Awaiting review</option>
        {saved.map((item, index) => <option key={item.name} value={String(index)}>{item.name}</option>)}
      </select>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={!ready}>Save view</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save drafting view</DialogTitle><DialogDescription>Keep these filters with your account so you can return to this worklist.</DialogDescription></DialogHeader>
          <Label htmlFor="drafting-view-name">View name</Label>
          <Input id="drafting-view-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="My review queue" />
          {saved.length > 0 && <ul className="max-h-40 space-y-1 overflow-auto">{saved.map(item => <li key={item.name} className="flex items-center justify-between gap-3 text-sm"><span>{item.name}</span><Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove saved view ${item.name}`} onClick={() => void persist(saved.filter(v => v.name !== item.name))}>Remove</Button></li>)}</ul>}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !trimmed || (saved.length >= 20 && !exists)} onClick={() => void persist([...saved.filter(v => v.name !== trimmed), { ...view, name: trimmed }])}>{busy ? 'Saving…' : exists ? 'Replace saved view' : 'Save view'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
