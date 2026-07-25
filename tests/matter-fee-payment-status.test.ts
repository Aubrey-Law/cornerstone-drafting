import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260811000000_matter_fee_payment_status.sql',
)

describe('matter fee payment status migration', () => {
  it('adds, constrains, and backfills the three-state fee status', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS fee_payment_status text')
    expect(sql).toContain("fee_payment_status IN ('unpaid', 'deposit', 'paid_in_full')")
    expect(sql).toContain("WHEN fee_collected IS TRUE THEN 'paid_in_full'")
    expect(sql).toContain("ELSE 'unpaid'")
    expect(sql).not.toContain('fee_collected_date = CURRENT_DATE')
  })

  it('keeps legacy boolean and status writes synchronized', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('trg_sync_matter_fee_payment_status')
    expect(sql).toContain("NEW.fee_collected := NEW.fee_payment_status = 'paid_in_full'")
    expect(sql).toContain("WHEN NEW.fee_collected IS TRUE THEN 'paid_in_full'")
  })

  it('is safe to reapply without replacing preserved payment dates', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS fee_payment_status')
    expect(sql).toContain('IF NOT EXISTS (')
    expect(sql).toContain(
      'DROP TRIGGER IF EXISTS trg_sync_matter_fee_payment_status ON public.matter_details',
    )
    expect(sql).not.toMatch(/fee_(?:collected|paid)_(?:at|date)\s*=/)
  })
})
