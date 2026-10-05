import { describe, expect, it } from 'vitest'
import { normalizeSigningDate, signingDateParts } from '@/lib/designSheet/signingDate'
import { withDerivedSigningParts } from '@/lib/designSheet/applyProposal'
import { coerceDesignSheetImport, getDesignSheetImportFieldMeta } from '@/lib/designSheetImport/shared'

describe('signing date and county are importable', () => {
  it('are in the import registry, county as a Massachusetts choice', () => {
    expect(getDesignSheetImportFieldMeta('signing_date')?.kind).toBe('string')
    expect(getDesignSheetImportFieldMeta('signing_county')?.options).toContain('Norfolk')
  })

  it('keeps month, year and notary commission out of the registry', () => {
    // Month and year follow from the date; the commission is the notary's fact.
    for (const field of ['signing_month', 'signing_year', 'notary_commission_expiration']) {
      expect(getDesignSheetImportFieldMeta(field), field).toBeNull()
    }
  })

  it('normalizes a written date and a county', () => {
    const { proposed, rejected } = coerceDesignSheetImport({
      signing_date: '11/03/2026',
      signing_county: 'norfolk',
    })
    expect(rejected).toEqual([])
    expect(proposed).toEqual({ signing_date: '2026-11-03', signing_county: 'Norfolk' })
  })

  it('surfaces a date that is not a date, and a county outside Massachusetts', () => {
    const { proposed, rejected } = coerceDesignSheetImport({
      signing_date: 'next spring',
      signing_county: 'Rockingham',
    })
    expect(proposed).toEqual({})
    expect(rejected.map(row => row.field).sort()).toEqual(['signing_county', 'signing_date'])
  })
})

describe('normalizeSigningDate', () => {
  it('reads the shapes notes arrive in', () => {
    expect(normalizeSigningDate('2026-11-03')).toBe('2026-11-03')
    expect(normalizeSigningDate('11/3/2026')).toBe('2026-11-03')
  })

  it('refuses a date that only looks valid', () => {
    expect(normalizeSigningDate('2026-02-31')).toBeNull()
    expect(normalizeSigningDate('TBD')).toBeNull()
  })
})

describe('an accepted signing date sets month and year', () => {
  it('derives them the way the sheet does', () => {
    expect(signingDateParts('2026-11-03')).toEqual({ signing_month: 'November', signing_year: '2026' })
    expect(withDerivedSigningParts({ signing_date: '2026-11-03', signing_county: 'Norfolk' }))
      .toEqual({ signing_month: 'November', signing_year: '2026' })
  })

  it('leaves them alone when no date was accepted', () => {
    expect(withDerivedSigningParts({ signing_county: 'Norfolk' })).toEqual({})
  })
})
