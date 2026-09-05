import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Supabase database types', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/db-types/src/supabase.generated.ts'), 'utf8')
  const generator = fs.readFileSync(path.join(process.cwd(), 'scripts/generateSupabaseTypes.mjs'), 'utf8')

  it('checks in generated schema types without a permissive table placeholder', () => {
    expect(source).toContain('PostgrestVersion:')
    expect(source).not.toContain('type AnyTable')
  })

  it('includes the pending canonical legal-field columns', () => {
    expect(source).toContain('citizenship_status: string | null')
    expect(source).toContain('matter_type: string | null')
  })

  it('generates atomically so a CLI failure cannot erase the checked-in schema', () => {
    expect(generator).toContain("if (result.status !== 0)")
    expect(generator).toContain('renameSync(temporaryPath, outputPath)')
  })
})
