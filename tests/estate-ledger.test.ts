import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LedgerInputError,
  computeAccount,
  ledgerCsv,
  parseAssetInput,
  parseEntryInput,
  sortEntries,
  type EstateAsset,
  type LedgerEntry,
} from '@/lib/estateLedger/model'

/**
 * The fiduciary ledger is the arithmetic a court account rests on. These pin
 * the account layout, that the balance is always proved by cash plus assets
 * still held, and the rules that keep an entry from double-counting an asset.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const M = 'matter-1'

const house: EstateAsset = { id: 'house', matterId: M, description: '12 Elm St', category: 'real_estate', probate: true, dateOfDeathValueCents: 500_000_00, valuationNote: 'Appraisal' }
const bank: EstateAsset = { id: 'bank', matterId: M, description: 'Checking', category: 'bank', probate: true, dateOfDeathValueCents: 20_000_00, valuationNote: null }
const car: EstateAsset = { id: 'car', matterId: M, description: 'Subaru', category: 'vehicle', probate: true, dateOfDeathValueCents: 8_000_00, valuationNote: null }
const ira: EstateAsset = { id: 'ira', matterId: M, description: 'IRA to daughter', category: 'retirement', probate: false, dateOfDeathValueCents: 90_000_00, valuationNote: null }

let seq = 0
function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amountCents'>): LedgerEntry {
  seq += 1
  return { id: `e${seq}`, matterId: M, entryDate: '2026-08-01', fund: 'principal', description: 'x', counterparty: null, assetId: null, ...over }
}

describe('the account', () => {
  it('starts from the probate inventory and leaves non-probate property out', () => {
    const account = computeAccount([house, bank, ira], [])
    expect(account.inventory).toBe(520_000_00)
    expect(account.nonProbate).toBe(90_000_00)
    expect(account.balance).toBe(520_000_00)
    expect(account.onHand).toEqual({ cash: 0, assets: 520_000_00, assetCount: 2 })
    expect(account.proves).toBe(true)
  })

  it('carries receipts, sales, disbursements and distributions to a proved balance', () => {
    const entries = [
      entry({ kind: 'sale', amountCents: 20_000_00, assetId: 'bank', description: 'Closed checking into estate account' }),
      entry({ kind: 'sale', amountCents: 530_000_00, assetId: 'house' }),
      entry({ kind: 'receipt', amountCents: 1_200_00, fund: 'income', description: 'Interest' }),
      entry({ kind: 'disbursement', amountCents: 9_500_00, description: 'Funeral' }),
      entry({ kind: 'distribution', amountCents: 8_000_00, assetId: 'car', description: 'Car to son' }),
      entry({ kind: 'distribution', amountCents: 100_000_00, description: 'Partial distribution' }),
    ]
    const account = computeAccount([house, bank, car, ira], entries)
    expect(account.principal.gains).toBe(30_000_00)
    expect(account.principal.losses).toBe(0)
    expect(account.principal.disbursements).toBe(9_500_00)
    expect(account.principal.distributions).toBe(108_000_00)
    expect(account.principal.balance).toBe(528_000_00 + 30_000_00 - 9_500_00 - 108_000_00)
    expect(account.income.balance).toBe(1_200_00)
    expect(account.onHand).toEqual({ cash: 20_000_00 + 530_000_00 + 1_200_00 - 9_500_00 - 100_000_00, assets: 0, assetCount: 0 })
    expect(account.proves).toBe(true)
    expect(account.overdrawn).toBe(false)
  })

  it('records a loss when a sale brings less than the inventory value', () => {
    const account = computeAccount([car], [entry({ kind: 'sale', amountCents: 6_500_00, assetId: 'car' })])
    expect(account.principal.losses).toBe(1_500_00)
    expect(account.balance).toBe(6_500_00)
    expect(account.proves).toBe(true)
  })

  it('flags cash paid out that never came in', () => {
    const account = computeAccount([house], [entry({ kind: 'disbursement', amountCents: 5_000_00 })])
    expect(account.overdrawn).toBe(true)
    expect(account.proves).toBe(true)
  })

  it('stops proving when an in-kind distribution was stored at the wrong value', () => {
    const account = computeAccount([car], [entry({ kind: 'distribution', amountCents: 1_00, assetId: 'car' })])
    expect(account.proves).toBe(false)
  })
})

describe('what an entry may say', () => {
  const assets = [house, car, ira]

  it('moves an in-kind distribution at its inventory value, whatever was typed', () => {
    const parsed = parseEntryInput({ kind: 'distribution', entryDate: '2026-09-01', amountCents: 1, description: 'Car to son', assetId: 'car' }, assets, [])
    expect(parsed.amountCents).toBe(8_000_00)
  })

  it('refuses a sale without an asset, and a receipt or disbursement with one', () => {
    expect(() => parseEntryInput({ kind: 'sale', entryDate: '2026-09-01', amountCents: 1, description: 'x' }, assets, [])).toThrow(/names the inventory asset/)
    expect(() => parseEntryInput({ kind: 'receipt', entryDate: '2026-09-01', amountCents: 1, description: 'x', assetId: 'car' }, assets, [])).toThrow(/does not name/)
  })

  it('refuses a non-probate asset, an asset already gone, and income for an asset', () => {
    expect(() => parseEntryInput({ kind: 'sale', entryDate: '2026-09-01', amountCents: 1, description: 'x', assetId: 'ira' }, assets, [])).toThrow(/non-probate/)
    const sold = [entry({ kind: 'sale', amountCents: 1, assetId: 'car' })]
    expect(() => parseEntryInput({ kind: 'distribution', entryDate: '2026-09-01', amountCents: 0, description: 'x', assetId: 'car' }, assets, sold)).toThrow(/already been sold/)
    expect(() => parseEntryInput({ kind: 'sale', entryDate: '2026-09-01', amountCents: 1, description: 'x', assetId: 'house', fund: 'income' }, assets, [])).toThrow(/principal/)
  })

  it('checks dates, amounts and text', () => {
    expect(() => parseEntryInput({ kind: 'receipt', entryDate: 'Sept 1', amountCents: 1, description: 'x' }, assets, [])).toThrow(/YYYY-MM-DD/)
    expect(() => parseEntryInput({ kind: 'receipt', entryDate: '2026-09-01', amountCents: 1.5, description: 'x' }, assets, [])).toThrow(/whole number of cents/)
    expect(() => parseEntryInput({ kind: 'receipt', entryDate: '2026-09-01', amountCents: 1, description: '  ' }, assets, [])).toThrow(LedgerInputError)
    expect(() => parseAssetInput({ description: 'x', category: 'yacht' })).toThrow(/category/)
    expect(parseAssetInput({ description: ' Checking ', dateOfDeathValueCents: 5 })).toMatchObject({ description: 'Checking', category: 'other', probate: true })
  })
})

describe('order and export', () => {
  it('lists entries by date, keeping the order recorded within a day', () => {
    const a = entry({ kind: 'receipt', amountCents: 1, entryDate: '2026-09-02' })
    const b = entry({ kind: 'receipt', amountCents: 2, entryDate: '2026-09-01' })
    const c = entry({ kind: 'receipt', amountCents: 3, entryDate: '2026-09-01' })
    expect(sortEntries([a, b, c]).map(item => item.id)).toEqual([b.id, c.id, a.id])
  })

  it('exports the inventory, entries and totals, defusing spreadsheet formulas', () => {
    const csv = ledgerCsv([house, { ...bank, description: '=HYPERLINK("x")' }], [entry({ kind: 'receipt', amountCents: 12_34, description: 'Refund, "utility"' })])
    expect(csv).toContain('Inventory,,Real estate,principal,12 Elm St,Appraisal,500000.00')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"Refund, ""utility"""')
    expect(csv).toContain('Account,,,,Balance on hand,,520012.34')
  })
})

describe('wiring', () => {
  it('keeps one disposal per asset in the database too', () => {
    const sql = read('supabase/migrations/20270126090000_estate_ledger.sql')
    expect(sql).toContain('create unique index if not exists estate_ledger_entries_asset_disposal_idx')
    expect(sql).toContain("(kind = 'sale' and asset_id is not null)")
    expect(sql).toContain('amount_cents bigint not null check (amount_cents >= 0)')
    expect(sql).toContain('on delete restrict')
  })

  it('shows the ledger on probate matters only, behind the staff gate', () => {
    expect(read('app/admin/matters/[id]/MatterDetailClient.tsx')).toContain('{showProbate && <EstateLedgerCard matterId={matterId} />}')
    for (const route of ['route.ts', 'assets/[assetId]/route.ts', 'entries/[entryId]/route.ts']) {
      expect(read(`app/api/admin/matters/[id]/estate-ledger/${route}`)).toContain('await requireAdmin(req)')
    }
  })

  it('has generated types for both tables', () => {
    const types = read('packages/db-types/src/supabase.generated.ts')
    expect(types).toContain('      estate_assets: {')
    expect(types).toContain('      estate_ledger_entries: {')
  })
})
