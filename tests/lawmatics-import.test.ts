import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeLawmaticsMaritalStatus } from '@/lib/lawmatics'

describe('Lawmatics import', () => {
  it('maps Lawmatics marital statuses to client_intake-safe values', () => {
    expect(normalizeLawmaticsMaritalStatus('Married')).toBe('married')
    expect(normalizeLawmaticsMaritalStatus('DOMESTIC_PARTNERSHIP')).toBe('married')
    expect(normalizeLawmaticsMaritalStatus('unknown')).toBeNull()
  })

  it('exposes OAuth connect and callback routes', () => {
    const connect = fs.readFileSync(path.join(process.cwd(), 'app/api/lawmatics/connect/route.ts'), 'utf8')
    const callback = fs.readFileSync(path.join(process.cwd(), 'app/api/lawmatics/callback/route.ts'), 'utf8')
    expect(connect).toContain('getAuthUrl')
    expect(connect).toContain('requireAdmin')
    expect(callback).toContain('exchangeCode')
    expect(callback).toContain('lawmatics_tokens')
  })

  it('imports matters through pull search + import routes', () => {
    const pull = fs.readFileSync(path.join(process.cwd(), 'app/api/lawmatics/pull/route.ts'), 'utf8')
    const importLib = fs.readFileSync(path.join(process.cwd(), 'lib/lawmatics/importMatter.ts'), 'utf8')
    const dialog = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/LawmaticsImportDialog.tsx'), 'utf8')
    const matters = fs.readFileSync(path.join(process.cwd(), 'app/admin/matters/MattersClient.tsx'), 'utf8')

    expect(pull).toContain('searchProspects')
    expect(pull).toContain('importMatterFromLawmaticsProspect')
    expect(importLib).toContain("status: 'in_progress'")
    expect(importLib).toContain('ensureDesignSheetSeededFromIntake')
    expect(dialog).toContain('/api/lawmatics/pull')
    expect(matters).toContain('Import from Lawmatics')
  })
})
