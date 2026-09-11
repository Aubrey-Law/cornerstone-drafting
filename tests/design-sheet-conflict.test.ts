import { describe, it, expect } from 'vitest'
import { compareDesignSheets, resolveDesignSheetConflict } from '@/lib/designSheet/designSheetConflict'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
const sheet = (values: Record<string, unknown>) => inflateDesignSheetRow({ id: 's', matter_id: 'm', ...values })!
describe('explicit design sheet recovery', () => {
  it('compares local and server-only changes, excluding stamps', () => {
    const local = sheet({ client_name: 'Local', updated_at: 'old', decisions: { deed: { county: 'A' } } })
    const latest = sheet({ client_name: 'Server', updated_at: 'new', decisions: { deed: { county: 'B' } } })
    const differences = compareDesignSheets(local, latest)
    expect(differences.map(d => d.path)).toEqual(expect.arrayContaining(['client_name', 'decisions.deed.county']))
    expect(differences.some(d => d.path.includes('updated_at'))).toBe(false)
    expect(() => resolveDesignSheetConflict(local, latest, {})).toThrow('Choose')
    const choices = Object.fromEntries(differences.map(d => [d.path, d.path === 'client_name' ? 'local' : 'latest'])) as Record<string, 'local' | 'latest'>
    const resolved = resolveDesignSheetConflict(local, latest, choices)
    expect(resolved.client_name).toBe('Local')
    expect((resolved.decisions?.deed as { county: string }).county).toBe('B')
    expect(resolved.updated_at).toBe('new')
  })
  it('preserves override protection from each chosen source without exposing metadata as a choice', () => {
    const local = sheet({ client_name: 'Attorney name', city: 'Local city', client_email: 'intake@example.com', overrides: { client_name: { original: 'Intake name', updated_by: 'attorney' } } })
    const latest = sheet({ client_name: 'Server name', city: 'Server city', client_email: 'attorney@example.com', overrides: { city: { original: 'Intake city', updated_by: 'other attorney' }, client_email: { original: 'intake@example.com', updated_by: 'other attorney' } } })
    const differences = compareDesignSheets(local, latest)
    expect(differences.some(d => d.path.startsWith('overrides'))).toBe(false)
    const resolved = resolveDesignSheetConflict(local, latest, { client_name: 'local', city: 'latest', client_email: 'local' })
    expect(resolved.overrides).toEqual({ client_name: local.overrides!.client_name, city: latest.overrides!.city })
  })

})
