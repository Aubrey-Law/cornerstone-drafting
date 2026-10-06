'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { uploadDocument } from '@/lib/documents'
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/documentUpload'
import { categoryLabel } from '@/lib/funding/model'
import { formatMoney } from '@/lib/funding/format'
import {
  CLIENT_ASSET_CATEGORIES,
  CLIENT_OWNERSHIP,
  OWNERSHIP_LABELS,
  PORTAL_STATE_LABELS,
  clientMayReport,
  portalInstruction,
  sortPortalAssets,
  summarisePortalAssets,
  type PortalAsset,
  type PortalFundingState,
} from '@/lib/funding/portal'
import { addPortalAsset, listPortalAssets, reportPortalAssetDone } from '@/lib/funding/portalClient'
import { cn } from '@/lib/utils'

const ACCEPT_ATTR = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.tif,.tiff'

const STATE_CLASS: Record<PortalFundingState, string> = {
  done: 'text-foreground/80',
  checking: 'text-foreground/80',
  todo: 'text-foreground',
  firm: 'text-muted-foreground',
  pending: 'text-muted-foreground',
}

const money = (value: number | string | null) => {
  const amount = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? formatMoney(amount) : null
}

/**
 * The client's assets with what each needs, an upload for the institution's
 * confirmation on the ones that are theirs to do, and a short form to add an
 * asset the firm does not know about. Nothing here marks anything confirmed:
 * what the client sends goes to the firm to check.
 */
export default function AssetsClient({
  matterId,
  matterClosed,
  initialAssets,
}: {
  matterId: string
  matterClosed: boolean
  initialAssets: PortalAsset[]
}) {
  const [assets, setAssets] = useState(initialAssets)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const summary = summarisePortalAssets(assets)

  async function refresh() {
    try {
      setAssets(sortPortalAssets(await listPortalAssets()))
    } catch {
      // The optimistic state stands; the next load corrects it.
    }
  }

  async function handleConfirmation(asset: PortalAsset, files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`${file.name} is larger than the upload limit.`)
      return
    }
    if (file.type && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error(`${file.name}: file type not accepted.`)
      return
    }
    setBusyId(asset.assetId)
    try {
      await uploadDocument(file, matterId, undefined, { assetId: asset.assetId })
      toast.success('Thank you. We will check the confirmation and let you know.')
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setBusyId(null)
      const input = inputRefs.current[asset.assetId]
      if (input) input.value = ''
    }
  }

  async function handleDone(asset: PortalAsset) {
    setBusyId(asset.assetId)
    try {
      setAssets(sortPortalAssets(await reportPortalAssetDone(asset.assetId, null)))
      toast.success('Noted. We will confirm it with the institution.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record that')
    } finally {
      setBusyId(null)
    }
  }

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setSaving(true)
    setFormError(null)
    try {
      const next = await addPortalAsset({
        category: data.get('category'),
        description: data.get('description'),
        institution: data.get('institution'),
        value: data.get('value'),
        ownership: data.get('ownership'),
        note: data.get('note'),
      })
      setAssets(sortPortalAssets(next))
      setAdding(false)
      form.reset()
      toast.success('Added. We will tell you what, if anything, it needs.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not add the asset')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6" data-testid="portal-assets">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">What your plan covers</h2>
          <p className="text-xs text-muted-foreground">
            {summary.total === 0
              ? 'No assets listed yet.'
              : `${summary.done} of ${summary.total} in the plan${summary.todo > 0 ? ` · ${summary.todo} need${summary.todo === 1 ? 's' : ''} your action` : ''}${summary.checking > 0 ? ` · ${summary.checking} being checked` : ''}`}
          </p>
        </div>

        {assets.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            We have not listed your assets yet. If you know what should be in your plan, add it below and we will take it from there.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60">
            {assets.map(asset => {
              const busy = busyId === asset.assetId
              const mayReport = clientMayReport(asset) && !matterClosed
              const value = money(asset.value)
              return (
                <li key={asset.assetId} className="py-4" data-testid={`portal-asset-${asset.assetId}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{asset.description || asset.categoryLabel}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {asset.categoryLabel}
                        {asset.ownership && asset.ownership !== 'client' ? ` · ${OWNERSHIP_LABELS[asset.ownership as keyof typeof OWNERSHIP_LABELS] ?? asset.ownership}` : ''}
                        {value ? ` · about ${value}` : ''}
                        {asset.source === 'client' ? ' · added by you' : ''}
                      </p>
                      <p className={cn('mt-1 flex items-center gap-1 text-xs font-medium', STATE_CLASS[asset.state])}>
                        {asset.state === 'done'
                          ? <CheckCircle2 className="size-3.5 text-primary" aria-hidden />
                          : <Clock className="size-3.5" aria-hidden />}
                        {PORTAL_STATE_LABELS[asset.state]}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{portalInstruction(asset)}</p>
                    </div>
                    {mayReport && (
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <input
                          ref={element => { inputRefs.current[asset.assetId] = element }}
                          type="file"
                          accept={ACCEPT_ATTR}
                          className="hidden"
                          aria-label={`Upload the confirmation for ${asset.description || asset.categoryLabel}`}
                          onChange={event => void handleConfirmation(asset, event.target.files)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1.5"
                          disabled={busy}
                          onClick={() => inputRefs.current[asset.assetId]?.click()}
                        >
                          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                          {asset.state === 'checking' ? 'Send another confirmation' : 'Send confirmation'}
                        </Button>
                        {asset.state === 'todo' && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void handleDone(asset)}
                          >
                            Done, but I have no confirmation yet
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {!matterClosed && (
        <section className="rounded-xl border border-border bg-card p-6" id="add">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-foreground">Something we are missing?</h2>
            {!adding && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" /> Add an asset
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            An account, a property or a policy that is not listed above. An approximate value is fine, and you can leave it blank.
          </p>

          {adding && (
            <form onSubmit={handleAdd} className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="asset-category">What kind of asset</Label>
                <NativeSelect id="asset-category" name="category" defaultValue="bank" required>
                  {CLIENT_ASSET_CATEGORIES.map(category => (
                    <option key={category} value={category}>{categoryLabel(category)}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-ownership">Whose is it</Label>
                <NativeSelect id="asset-ownership" name="ownership" defaultValue="client">
                  {CLIENT_OWNERSHIP.map(ownership => (
                    <option key={ownership} value={ownership}>{OWNERSHIP_LABELS[ownership]}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="asset-description">Description</Label>
                <Input id="asset-description" name="description" required maxLength={200} placeholder="For example: Chase checking account, or 12 Elm Street" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-institution">Institution (optional)</Label>
                <Input id="asset-institution" name="institution" maxLength={120} placeholder="Bank, brokerage or insurer" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-value">Approximate value (optional)</Label>
                <Input id="asset-value" name="value" inputMode="numeric" placeholder="$" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="asset-note">Anything we should know (optional)</Label>
                <Textarea id="asset-note" name="note" rows={2} maxLength={500} />
              </div>
              {formError && (
                <p role="alert" className="text-sm text-destructive sm:col-span-2">{formError}</p>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? 'Adding…' : 'Add asset'}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setAdding(false); setFormError(null) }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  )
}
