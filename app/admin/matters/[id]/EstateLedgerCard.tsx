'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import { firmTodayKey } from '@/lib/firmDate'
import { formatCents, parseDollarsToCents } from '@/lib/payroll/money'
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ENTRY_KINDS,
  ENTRY_KIND_LABELS,
  type AssetCategory,
  type EntryKind,
  type EstateAccount,
  type EstateAsset,
  type Fund,
  type LedgerEntry,
} from '@/lib/estateLedger/model'

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm'

interface LedgerResponse {
  assets: EstateAsset[]
  entries: LedgerEntry[]
  account: EstateAccount
  unavailable: boolean
}

const emptyAsset = { id: null as string | null, description: '', category: 'bank' as AssetCategory, value: '', probate: true, note: '' }
const emptyEntry = (): { date: string; kind: EntryKind; fund: Fund; amount: string; description: string; counterparty: string; assetId: string } =>
  ({ date: firmTodayKey(), kind: 'receipt', fund: 'principal', amount: '', description: '', counterparty: '', assetId: '' })

/**
 * The estate's own books: the inventory at date-of-death value, every receipt,
 * payment, sale and distribution since, and the account they add up to. The
 * balance is proved against cash and the assets still held; a mismatch or an
 * overdrawn cash line means an entry is missing or wrong.
 */
export function EstateLedgerCard({ matterId, trust = false }: { matterId: string; trust?: boolean }) {
  const token = useAccessToken()
  const [ledger, setLedger] = useState<LedgerResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assetForm, setAssetForm] = useState<typeof emptyAsset | null>(null)
  const [entryForm, setEntryForm] = useState<ReturnType<typeof emptyEntry> | null>(null)
  const [busy, setBusy] = useState(false)

  const headers = useCallback((json = false) => ({
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }), [token])
  const base = `/api/admin/matters/${matterId}/estate-ledger`

  const load = useCallback(async () => {
    if (!token) return
    try {
      setLedger(await apiRequest<LedgerResponse>(base, { headers: headers() }))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The ledger is unavailable')
    }
  }, [token, base, headers])

  useEffect(() => { void load() }, [load])

  const assetName = useMemo(() => new Map((ledger?.assets ?? []).map(asset => [asset.id, asset.description])), [ledger])
  const disposedIds = useMemo(() => new Set((ledger?.entries ?? []).map(entry => entry.assetId).filter(Boolean)), [ledger])
  const assetsOnHand = (ledger?.assets ?? []).filter(asset => asset.probate && !disposedIds.has(asset.id))

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      await load()
      return true
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveAsset() {
    if (!assetForm) return
    const cents = parseDollarsToCents(assetForm.value || '0')
    if (cents === null) return toast.error('Enter the value as dollars, like 125,000.00')
    const body = JSON.stringify({ type: 'asset', description: assetForm.description, category: assetForm.category, probate: assetForm.probate, dateOfDeathValueCents: cents, valuationNote: assetForm.note || null })
    const ok = await run(() => assetForm.id
      ? apiRequest(`${base}/assets/${assetForm.id}`, { method: 'PATCH', headers: headers(true), body }, 'Could not save the asset')
      : apiRequest(base, { method: 'POST', headers: headers(true), body }, 'Could not add the asset'), assetForm.id ? 'Asset updated' : 'Asset added to the inventory')
    if (ok) setAssetForm(null)
  }

  async function saveEntry() {
    if (!entryForm) return
    const inKind = entryForm.kind === 'distribution' && entryForm.assetId
    const cents = inKind ? 0 : parseDollarsToCents(entryForm.amount)
    if (cents === null) return toast.error('Enter the amount as dollars, like 1,250.00')
    const ok = await run(() => apiRequest(base, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({
        type: 'entry',
        entryDate: entryForm.date,
        kind: entryForm.kind,
        fund: entryForm.assetId ? 'principal' : entryForm.fund,
        amountCents: cents,
        description: entryForm.description,
        counterparty: entryForm.counterparty || null,
        assetId: entryForm.assetId || null,
      }),
    }, 'Could not add the entry'), 'Entry added')
    if (ok) setEntryForm(null)
  }

  async function download() {
    if (!token) return
    try {
      const res = await fetch(`${base}?format=csv`, { headers: headers() })
      if (!res.ok) throw new Error('Could not download the ledger')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `estate-ledger-${matterId.slice(0, 8)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not download the ledger')
    }
  }

  if (error) return <section className="rounded-lg border border-border bg-card p-4 text-sm text-destructive">{error}</section>
  if (!ledger) return <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">Loading the estate ledger…</section>
  if (ledger.unavailable) return <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">The estate ledger arrives with the next database update.</section>

  const { account } = ledger
  const assetNeeded = entryForm?.kind === 'sale' || (entryForm?.kind === 'distribution' && entryForm.assetId !== '')

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4" data-testid="estate-ledger">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{trust ? 'Trust ledger' : 'Estate ledger'}</h3>
          <p className="text-xs text-muted-foreground">The inventory at date-of-death value and every dollar since, adding up to the account.</p>
        </div>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void download()}>
          <Download className="h-3.5 w-3.5" />
          Download CSV
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {([
          ['Inventory', account.inventory],
          ['Receipts', account.principal.receipts + account.income.receipts],
          ['Gains less losses', account.principal.gains - account.principal.losses],
          ['Disbursements', account.principal.disbursements + account.income.disbursements],
          ['Distributions', account.principal.distributions + account.income.distributions],
          ['Balance on hand', account.balance],
        ] as Array<[string, number]>).map(([label, amount]) => (
          <div key={label} className="flex justify-between gap-2 border-b border-border/60 py-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{formatCents(amount)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Held as {formatCents(account.onHand.cash)} cash and {account.onHand.assetCount} {account.onHand.assetCount === 1 ? 'asset' : 'assets'} worth {formatCents(account.onHand.assets)}.
        {' '}Principal {formatCents(account.principal.balance)} · income {formatCents(account.income.balance)}
        {account.nonProbate > 0 && <> · {formatCents(account.nonProbate)} {trust ? 'outside the trust' : 'non-probate property'} listed outside the account</>}.
      </p>
      {(!account.proves || account.overdrawn) && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-amber">
          <AlertTriangle className="h-3.5 w-3.5" />
          {account.overdrawn ? 'More has been paid out than came in. An entry is missing or wrong.' : 'Cash and assets on hand do not add up to the balance. Check the in-kind distributions.'}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold">Inventory</h4>
          <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setAssetForm({ ...emptyAsset })}>
            <Plus className="h-3.5 w-3.5" /> Add asset
          </Button>
        </div>
        {assetForm && (
          <form className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void saveAsset() }}>
            <div className="sm:col-span-2">
              <Label htmlFor="asset-description" className="text-xs">Asset</Label>
              <Input id="asset-description" required maxLength={500} value={assetForm.description} placeholder="Checking account ending 4410, Eastern Bank" onChange={event => setAssetForm({ ...assetForm, description: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="asset-category" className="text-xs">Kind</Label>
              <select id="asset-category" className={selectClass} value={assetForm.category} onChange={event => setAssetForm({ ...assetForm, category: event.target.value as AssetCategory })}>
                {ASSET_CATEGORIES.map(category => <option key={category} value={category}>{ASSET_CATEGORY_LABELS[category]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="asset-value" className="text-xs">Value at date of death ($)</Label>
              <Input id="asset-value" inputMode="decimal" value={assetForm.value} placeholder="0.00" onChange={event => setAssetForm({ ...assetForm, value: event.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="asset-note" className="text-xs">How it was valued (optional)</Label>
              <Input id="asset-note" maxLength={1000} value={assetForm.note} placeholder="Statement balance on the date of death" onChange={event => setAssetForm({ ...assetForm, note: event.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={assetForm.probate} onChange={event => setAssetForm({ ...assetForm, probate: event.target.checked })} />
              {trust ? 'Held in the trust (untick for assets passing outside it)' : 'Probate property (untick for joint, beneficiary or trust assets)'}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAssetForm(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={busy || !assetForm.description.trim()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : assetForm.id ? 'Save' : 'Add'}</Button>
            </div>
          </form>
        )}
        {ledger.assets.length === 0 && !assetForm && <p className="text-xs text-muted-foreground">Nothing on the inventory yet.</p>}
        <ul className="divide-y divide-border/60">
          {ledger.assets.map(asset => (
            <li key={asset.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{asset.description}</span>
                <span className="text-muted-foreground"> · {ASSET_CATEGORY_LABELS[asset.category]}{!asset.probate && (trust ? ' · outside the trust' : ' · non-probate')}{disposedIds.has(asset.id) && ' · disposed of'}</span>
              </span>
              <span className="tabular-nums">{formatCents(asset.dateOfDeathValueCents)}</span>
              <span className="flex">
                <Button type="button" size="sm" variant="ghost" aria-label={`Edit ${asset.description}`} onClick={() => setAssetForm({ id: asset.id, description: asset.description, category: asset.category, value: (asset.dateOfDeathValueCents / 100).toFixed(2), probate: asset.probate, note: asset.valuationNote ?? '' })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${asset.description}`} disabled={busy} onClick={() => void run(() => apiRequest(`${base}/assets/${asset.id}`, { method: 'DELETE', headers: headers() }, 'Could not remove the asset'), 'Asset removed')}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold">Receipts, payments and distributions</h4>
          <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setEntryForm(emptyEntry())}>
            <Plus className="h-3.5 w-3.5" /> Add entry
          </Button>
        </div>
        {entryForm && (
          <form className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); void saveEntry() }}>
            <div>
              <Label htmlFor="entry-date" className="text-xs">Date</Label>
              <Input id="entry-date" type="date" required value={entryForm.date} onChange={event => setEntryForm({ ...entryForm, date: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="entry-kind" className="text-xs">Type</Label>
              <select id="entry-kind" className={selectClass} value={entryForm.kind} onChange={event => setEntryForm({ ...entryForm, kind: event.target.value as EntryKind, assetId: '' })}>
                {ENTRY_KINDS.map(kind => <option key={kind} value={kind}>{ENTRY_KIND_LABELS[kind]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="entry-fund" className="text-xs">Fund</Label>
              <select id="entry-fund" className={selectClass} value={assetNeeded ? 'principal' : entryForm.fund} disabled={assetNeeded} onChange={event => setEntryForm({ ...entryForm, fund: event.target.value as Fund })}>
                <option value="principal">Principal</option>
                <option value="income">Income</option>
              </select>
            </div>
            {(entryForm.kind === 'sale' || entryForm.kind === 'distribution') && (
              <div className="sm:col-span-3">
                <Label htmlFor="entry-asset" className="text-xs">{entryForm.kind === 'sale' ? 'Asset sold' : 'Asset distributed in kind (leave blank for cash)'}</Label>
                <select id="entry-asset" className={selectClass} value={entryForm.assetId} onChange={event => setEntryForm({ ...entryForm, assetId: event.target.value })}>
                  <option value="">{entryForm.kind === 'sale' ? 'Choose an asset' : 'Cash'}</option>
                  {assetsOnHand.map(asset => <option key={asset.id} value={asset.id}>{asset.description} ({formatCents(asset.dateOfDeathValueCents)})</option>)}
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="entry-description" className="text-xs">Description</Label>
              <Input id="entry-description" required maxLength={500} value={entryForm.description} placeholder={entryForm.kind === 'disbursement' ? 'Funeral home, final bill' : 'Final paycheck from employer'} onChange={event => setEntryForm({ ...entryForm, description: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="entry-amount" className="text-xs">{entryForm.kind === 'sale' ? 'Net proceeds ($)' : 'Amount ($)'}</Label>
              <Input id="entry-amount" inputMode="decimal" value={entryForm.kind === 'distribution' && entryForm.assetId ? 'At inventory value' : entryForm.amount} disabled={entryForm.kind === 'distribution' && entryForm.assetId !== ''} placeholder="0.00" onChange={event => setEntryForm({ ...entryForm, amount: event.target.value })} />
            </div>
            {!assetNeeded && (
              <div className="sm:col-span-2">
                <Label htmlFor="entry-counterparty" className="text-xs">{entryForm.kind === 'receipt' ? 'Received from' : 'Paid to'} (optional)</Label>
                <Input id="entry-counterparty" maxLength={200} value={entryForm.counterparty} onChange={event => setEntryForm({ ...entryForm, counterparty: event.target.value })} />
              </div>
            )}
            <div className="flex items-end justify-end gap-2 sm:col-start-3">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEntryForm(null)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={busy || !entryForm.description.trim() || (entryForm.kind === 'sale' && !entryForm.assetId)}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}</Button>
            </div>
          </form>
        )}
        {ledger.entries.length === 0 && !entryForm && <p className="text-xs text-muted-foreground">No entries yet.</p>}
        <ul className="divide-y divide-border/60">
          {ledger.entries.map(entry => {
            const outflow = entry.kind === 'disbursement' || entry.kind === 'distribution'
            return (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{entry.entryDate}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{entry.description}</span>
                  <span className="text-muted-foreground">
                    {' · '}{ENTRY_KIND_LABELS[entry.kind]}{entry.fund === 'income' && ' (income)'}
                    {entry.assetId ? ` · ${assetName.get(entry.assetId) ?? 'asset'}` : entry.counterparty ? ` · ${entry.counterparty}` : ''}
                  </span>
                </span>
                <span className="tabular-nums">{outflow ? '−' : ''}{formatCents(entry.amountCents)}</span>
                <Button type="button" size="sm" variant="ghost" aria-label={`Delete entry ${entry.description}`} disabled={busy} onClick={() => void run(() => apiRequest(`${base}/entries/${entry.id}`, { method: 'DELETE', headers: headers() }, 'Could not delete the entry'), 'Entry deleted')}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
