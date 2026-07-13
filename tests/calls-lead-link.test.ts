import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('call lead linking', () => {
  it('adds a mutually exclusive lead association and lead phone autoassignment', () => {
    const migration = source('supabase/migrations/20260801000000_calls_lead_link.sql')
    expect(migration).toMatch(/lead_id uuid references public\.client_intake/i)
    expect(migration).toMatch(/matter_id is null or lead_id is null/i)
    expect(migration).toMatch(/ci\.matter_id is null/i)
    expect(migration).toMatch(/new\.lead_id := matched_lead/i)
  })

  it('only counts calls with neither association as unlinked', () => {
    for (const file of ['app/admin/calls/page.tsx', 'lib/queries/sidebarCounts.ts', 'lib/queries/today.ts']) {
      const contents = source(file)
      expect(contents).toMatch(/\.is\('matter_id', null\)/)
      expect(contents).toMatch(/\.is\('lead_id', null\)/)
    }
  })

  it('exposes calls on lead detail and accepts lead assignment', () => {
    expect(source('app/admin/leads/[id]/LeadDetailClient.tsx')).toMatch(/<CallList leadId=\{lead\.id\}/)
    expect(source('app/api/admin/calls/[id]/assign/route.ts')).toMatch(/leadId/)
    expect(source('app/api/admin/leads/[id]/calls/route.ts')).toMatch(/\.eq\('lead_id', leadId\)/)
  })
})
